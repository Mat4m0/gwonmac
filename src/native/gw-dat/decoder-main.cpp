#include <cstdint>
#include <cstdio>
#include <iostream>
#include <iterator>
#include <string_view>
#include <vector>

#include "vendor/gwdat/AtexReader.h"
#include "vendor/gwdat/xentax.h"

namespace {
constexpr std::size_t kMaxCompressedBytes = 1024 * 1024;
constexpr std::uint32_t kMaxDecodedBytes = 1024 * 1024;

void writeU16(std::uint16_t value) {
  std::cout.put(static_cast<char>(value & 0xff));
  std::cout.put(static_cast<char>((value >> 8) & 0xff));
}

void writeU32(std::uint32_t value) {
  std::cout.put(static_cast<char>(value & 0xff));
  std::cout.put(static_cast<char>((value >> 8) & 0xff));
  std::cout.put(static_cast<char>((value >> 16) & 0xff));
  std::cout.put(static_cast<char>((value >> 24) & 0xff));
}
}

int main(int argc, char** argv) {
  const bool raw = argc == 2 && std::string_view(argv[1]) == "--raw";
  if (argc != (raw ? 2 : 1)) return 1;
  std::vector<unsigned char> input{
      std::istreambuf_iterator<char>(std::cin),
      std::istreambuf_iterator<char>()};
  if (input.size() < 8 || input.size() > kMaxCompressedBytes) return 2;

  const std::size_t tail = input.size() - 4;
  const std::uint32_t declared =
      static_cast<std::uint32_t>(input[tail])
      | (static_cast<std::uint32_t>(input[tail + 1]) << 8)
      | (static_cast<std::uint32_t>(input[tail + 2]) << 16)
      | (static_cast<std::uint32_t>(input[tail + 3]) << 24);
  if (declared < 12 || declared > kMaxDecodedBytes) return 3;

  unsigned char* unpacked = nullptr;
  int unpackedSize = 0;
  UnpackGWDat(input.data(), static_cast<int>(input.size()), unpacked, unpackedSize);
  if (!unpacked || unpackedSize != static_cast<int>(declared)) {
    delete[] unpacked;
    return 4;
  }

  if (raw) {
    std::cout.write("GWDB", 4);
    writeU32(static_cast<std::uint32_t>(unpackedSize));
    std::cout.write(
        reinterpret_cast<const char*>(unpacked),
        static_cast<std::streamsize>(unpackedSize));
    delete[] unpacked;
    return std::cout.good() ? 0 : 6;
  }

  const DatTexture texture = ProcessImageFile(unpacked, unpackedSize);
  delete[] unpacked;
  if (
      texture.width <= 0 || texture.height <= 0
      || texture.rgba_data.size()
          != static_cast<std::size_t>(texture.width)
              * static_cast<std::size_t>(texture.height)
  ) {
    return 5;
  }

  std::cout.write("GWIC", 4);
  writeU16(static_cast<std::uint16_t>(texture.width));
  writeU16(static_cast<std::uint16_t>(texture.height));
  std::cout.write(
      reinterpret_cast<const char*>(texture.rgba_data.data()),
      static_cast<std::streamsize>(texture.rgba_data.size() * 4));
  return std::cout.good() ? 0 : 6;
}
