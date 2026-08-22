#include <array>
#include <cassert>
#include <cstdint>
#include <cstring>

#include "texture-layout.h"
#include "vendor/gwdat/AtexDecompress.h"
#include "vendor/gwdat/AtexReader.h"

namespace {
int decompress_calls = 0;

std::array<unsigned char, 24> textureHeader(std::uint16_t width, std::uint16_t height)
{
    std::array<unsigned char, 24> header{};
    const std::uint32_t magic = 'XTTA';
    const std::uint32_t format = 'TXD' | (static_cast<std::uint32_t>('1') << 24);
    std::memcpy(header.data(), &magic, sizeof(magic));
    std::memcpy(header.data() + 4, &format, sizeof(format));
    std::memcpy(header.data() + 8, &width, sizeof(width));
    std::memcpy(header.data() + 10, &height, sizeof(height));
    const std::uint32_t data_size = 12;
    std::memcpy(header.data() + 12, &data_size, sizeof(data_size));
    return header;
}

void expectRefused(std::uint16_t width, std::uint16_t height)
{
    auto header = textureHeader(width, height);
    const int calls_before = decompress_calls;
    const DatTexture texture = ProcessImageFile(header.data(), static_cast<int>(header.size()));
    assert(texture.rgba_data.empty());
    assert(decompress_calls == calls_before);
}

void expectAccepted(std::uint16_t width, std::uint16_t height)
{
    auto header = textureHeader(width, height);
    const int calls_before = decompress_calls;
    const DatTexture texture = ProcessImageFile(header.data(), static_cast<int>(header.size()));
    assert(texture.width == width);
    assert(texture.height == height);
    assert(texture.rgba_data.size()
        == static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
    assert(decompress_calls == calls_before + 1);
}
}

void AtexDecompress(
    unsigned int*, unsigned int, unsigned int, const SImageDescriptor&, unsigned int*)
{
    ++decompress_calls;
}

int main()
{
    assert(!ReadTextureLayout(nullptr, 12));
    auto short_header = textureHeader(4, 4);
    const int calls_before = decompress_calls;
    assert(ProcessImageFile(short_header.data(), 23).rgba_data.empty());
    assert(ProcessImageFile(short_header.data(), -1).rgba_data.empty());
    assert(decompress_calls == calls_before);

    expectRefused(0, 4);
    expectRefused(4, 0);
    expectRefused(2, 4);
    expectRefused(4, 6);
    expectRefused(260, 4);
    expectRefused(4, 260);
    expectRefused(65535, 65535);

    auto malformed = textureHeader(4, 4);
    malformed[0] = 0;
    assert(ProcessImageFile(malformed.data(), static_cast<int>(malformed.size())).rgba_data.empty());
    assert(decompress_calls == calls_before);

    expectAccepted(4, 4);
    expectAccepted(256, 256);
}
