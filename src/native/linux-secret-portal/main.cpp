#include <gio/gio.h>
#include <gio/gunixfdlist.h>
#include <glib.h>
#include <unistd.h>

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr std::size_t kMaximumValue = 4096;
constexpr std::array<unsigned char, 8> kProtocol = {
    'G', 'W', 'S', 'P', 'v', '1', '\0', '\0'};

void Zero(std::vector<unsigned char> &value) {
  volatile unsigned char *bytes = value.data();
  for (std::size_t index = 0; index < value.size(); ++index) bytes[index] = 0;
  value.clear();
}

bool ReadExact(FILE *stream, unsigned char *output, std::size_t size) {
  std::size_t offset = 0;
  while (offset < size) {
    const std::size_t read = std::fread(output + offset, 1, size - offset, stream);
    if (read == 0) return false;
    offset += read;
  }
  return true;
}

bool WriteExact(FILE *stream, const unsigned char *input, std::size_t size) {
  std::size_t offset = 0;
  while (offset < size) {
    const std::size_t written = std::fwrite(input + offset, 1, size - offset, stream);
    if (written == 0) return false;
    offset += written;
  }
  return true;
}

std::array<unsigned char, 4> EncodeLength(std::size_t value) {
  return {
      static_cast<unsigned char>((value >> 24U) & 0xffU),
      static_cast<unsigned char>((value >> 16U) & 0xffU),
      static_cast<unsigned char>((value >> 8U) & 0xffU),
      static_cast<unsigned char>(value & 0xffU),
  };
}

bool ReadToken(std::string *token) {
  std::array<unsigned char, 4> encoded{};
  if (!ReadExact(stdin, encoded.data(), encoded.size())) return false;
  const std::uint32_t length =
      (static_cast<std::uint32_t>(encoded[0]) << 24U)
      | (static_cast<std::uint32_t>(encoded[1]) << 16U)
      | (static_cast<std::uint32_t>(encoded[2]) << 8U)
      | static_cast<std::uint32_t>(encoded[3]);
  if (length > kMaximumValue) return false;
  std::vector<unsigned char> bytes(length);
  if (length > 0 && !ReadExact(stdin, bytes.data(), bytes.size())) return false;
  if (std::memchr(bytes.data(), '\0', bytes.size()) != nullptr) {
    Zero(bytes);
    return false;
  }
  token->assign(bytes.begin(), bytes.end());
  Zero(bytes);
  return true;
}

struct RequestState {
  GMainLoop *loop = nullptr;
  std::string expectedHandle;
  std::string token;
  bool complete = false;
  bool success = false;
};

void OnResponse(
    GDBusConnection *, const gchar *, const gchar *objectPath, const gchar *,
    const gchar *, GVariant *parameters, gpointer userData) {
  auto &state = *static_cast<RequestState *>(userData);
  if (state.expectedHandle != objectPath) return;
  guint response = 1;
  GVariant *results = nullptr;
  g_variant_get(parameters, "(u@a{sv})", &response, &results);
  if (response == 0) {
    GVariant *token = g_variant_lookup_value(results, "token", G_VARIANT_TYPE_STRING);
    if (token != nullptr) {
      state.token = g_variant_get_string(token, nullptr);
      g_variant_unref(token);
    }
    state.success = true;
  }
  g_variant_unref(results);
  state.complete = true;
  g_main_loop_quit(state.loop);
}

gboolean OnTimeout(gpointer userData) {
  auto &state = *static_cast<RequestState *>(userData);
  if (!state.complete) g_main_loop_quit(state.loop);
  return G_SOURCE_REMOVE;
}

bool RetrieveSecret(
    const std::string &previousToken, std::string *nextToken,
    std::vector<unsigned char> *secret) {
  GError *error = nullptr;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error);
  if (bus == nullptr) {
    if (error != nullptr) g_error_free(error);
    return false;
  }

  int pipeFds[2] = {-1, -1};
  if (pipe(pipeFds) != 0) {
    g_object_unref(bus);
    return false;
  }
  GUnixFDList *fdList = g_unix_fd_list_new();
  const int fdIndex = g_unix_fd_list_append(fdList, pipeFds[1], &error);
  if (fdIndex < 0) {
    if (error != nullptr) g_error_free(error);
    close(pipeFds[0]);
    close(pipeFds[1]);
    g_object_unref(fdList);
    g_object_unref(bus);
    return false;
  }

  gchar *uuid = g_uuid_string_random();
  std::string handleToken = uuid;
  g_free(uuid);
  for (char &value : handleToken) {
    if (value == '-') value = '_';
  }

  RequestState state;
  state.loop = g_main_loop_new(nullptr, FALSE);
  const guint subscription = g_dbus_connection_signal_subscribe(
      bus, "org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request",
      "Response", nullptr, nullptr, G_DBUS_SIGNAL_FLAGS_NONE, OnResponse,
      &state, nullptr);

  GVariantBuilder options;
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token",
                        g_variant_new_string(handleToken.c_str()));
  if (!previousToken.empty()) {
    g_variant_builder_add(&options, "{sv}", "token",
                          g_variant_new_string(previousToken.c_str()));
  }
  GVariant *result = g_dbus_connection_call_with_unix_fd_list_sync(
      bus, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
      "org.freedesktop.portal.Secret", "RetrieveSecret",
      g_variant_new("(ha{sv})", fdIndex, &options), G_VARIANT_TYPE("(o)"),
      G_DBUS_CALL_FLAGS_NONE, 30000, fdList, nullptr, nullptr, &error);
  close(pipeFds[1]);
  pipeFds[1] = -1;
  g_object_unref(fdList);

  bool ok = result != nullptr;
  if (ok) {
    const gchar *handle = nullptr;
    g_variant_get(result, "(&o)", &handle);
    state.expectedHandle = handle;
    g_variant_unref(result);
    const guint timeout = g_timeout_add_seconds(30, OnTimeout, &state);
    g_main_loop_run(state.loop);
    if (state.complete) g_source_remove(timeout);
    ok = state.complete && state.success;
  } else if (error != nullptr) {
    g_error_free(error);
  }

  if (ok) {
    std::array<unsigned char, 1024> buffer{};
    while (true) {
      const ssize_t count = read(pipeFds[0], buffer.data(), buffer.size());
      if (count == 0) break;
      if (count < 0 || secret->size() + static_cast<std::size_t>(count) > kMaximumValue) {
        ok = false;
        break;
      }
      secret->insert(secret->end(), buffer.begin(), buffer.begin() + count);
    }
    volatile unsigned char *bytes = buffer.data();
    for (std::size_t index = 0; index < buffer.size(); ++index) bytes[index] = 0;
    ok = ok && secret->size() >= 16;
  }

  close(pipeFds[0]);
  g_dbus_connection_signal_unsubscribe(bus, subscription);
  g_main_loop_unref(state.loop);
  g_object_unref(bus);
  if (!ok) {
    Zero(*secret);
    return false;
  }
  *nextToken = state.token;
  return true;
}

}  // namespace

int main() {
  std::string previousToken;
  if (!ReadToken(&previousToken)) return 2;
  std::string nextToken;
  std::vector<unsigned char> secret;
  if (!RetrieveSecret(previousToken, &nextToken, &secret)) {
    std::fputs("Secret portal unavailable\n", stderr);
    return 3;
  }
  const auto tokenLength = EncodeLength(nextToken.size());
  const auto secretLength = EncodeLength(secret.size());
  const bool written =
      WriteExact(stdout, kProtocol.data(), kProtocol.size())
      && WriteExact(stdout, tokenLength.data(), tokenLength.size())
      && WriteExact(stdout, secretLength.data(), secretLength.size())
      && WriteExact(stdout,
                    reinterpret_cast<const unsigned char *>(nextToken.data()),
                    nextToken.size())
      && WriteExact(stdout, secret.data(), secret.size())
      && std::fflush(stdout) == 0;
  Zero(secret);
  return written ? 0 : 4;
}
