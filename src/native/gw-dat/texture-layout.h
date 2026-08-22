#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <optional>

struct TextureLayout
{
    int width;
    int height;
    std::size_t pixel_count;
    std::size_t rgba_bytes;
    std::size_t block_count;
};

inline std::optional<TextureLayout> ReadTextureLayout(const unsigned char* data, std::size_t size)
{
    constexpr std::size_t header_size = 12;
    constexpr std::uint16_t max_dimension = 256;
    constexpr std::size_t pixels_per_block = 16;
    constexpr std::size_t bytes_per_pixel = 4;

    if (data == nullptr || size < header_size)
    {
        return std::nullopt;
    }

    std::uint16_t width = 0;
    std::uint16_t height = 0;
    std::memcpy(&width, data + 8, sizeof(width));
    std::memcpy(&height, data + 10, sizeof(height));

    if (width == 0 || height == 0 || width > max_dimension || height > max_dimension
        || width % 4 != 0 || height % 4 != 0)
    {
        return std::nullopt;
    }

    const std::size_t wide_width = width;
    const std::size_t wide_height = height;
    if (wide_width > std::numeric_limits<std::size_t>::max() / wide_height)
    {
        return std::nullopt;
    }
    const std::size_t pixel_count = wide_width * wide_height;
    if (pixel_count > std::numeric_limits<std::size_t>::max() / bytes_per_pixel)
    {
        return std::nullopt;
    }

    return TextureLayout{
        static_cast<int>(width),
        static_cast<int>(height),
        pixel_count,
        pixel_count * bytes_per_pixel,
        pixel_count / pixels_per_block,
    };
}
