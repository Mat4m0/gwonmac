#include <cstdint>
#include <cstring>
#include <vector>

#include "AtexReader.h"
#include "AtexDecompress.h"
#include "../../texture-layout.h"

#pragma pack(1)

static_assert(sizeof(RGBA) == 4);

union DXT1Color
{
    struct
    {
        unsigned r1 : 5, g1 : 6, b1 : 5, r2 : 5, g2 : 6, b2 : 5;
    };
    struct
    {
        unsigned short c1, c2;
    };
};

struct DXT5Alpha
{
    unsigned char a0, a1;
    __int64 table;
};

std::vector<RGBA> ProcessDXT1(unsigned char* data, const TextureLayout& layout)
{
    DXT1Color* coltable = new DXT1Color[layout.block_count];
    unsigned int* blocktable = new unsigned int[layout.block_count];

    unsigned int* d = (unsigned int*)data;

    for (std::size_t x = 0; x < layout.block_count; x++)
    {
        coltable[x] = *(DXT1Color*)&d[x * 2];
        blocktable[x] = d[x * 2 + 1];
    }

    std::vector<RGBA> image(layout.pixel_count);
    memset(image.data(), 0, layout.rgba_bytes);

    int p = 0;
    for (int y = 0; y < layout.height / 4; y++)
        for (int x = 0; x < layout.width / 4; x++)
        {
            RGBA ctbl[4];
            memset(ctbl, 255, 16);
            DXT1Color c = coltable[p];
            ctbl[0].r = c.r1 << 3;
            ctbl[0].g = c.g1 << 2;
            ctbl[0].b = c.b1 << 3;
            ctbl[1].r = c.r2 << 3;
            ctbl[1].g = c.g2 << 2;
            ctbl[1].b = c.b2 << 3;

            if (c.c1 > c.c2)
            {
                ctbl[2].r = (int)((ctbl[0].r * 2 + ctbl[1].r) / 3.);
                ctbl[2].g = (int)((ctbl[0].g * 2 + ctbl[1].g) / 3.);
                ctbl[2].b = (int)((ctbl[0].b * 2 + ctbl[1].b) / 3.);
                ctbl[3].r = (int)((ctbl[0].r + ctbl[1].r * 2) / 3.);
                ctbl[3].g = (int)((ctbl[0].g + ctbl[1].g * 2) / 3.);
                ctbl[3].b = (int)((ctbl[0].b + ctbl[1].b * 2) / 3.);
            }
            else
            {
                ctbl[2].r = (int)((ctbl[0].r + ctbl[1].r) / 2.);
                ctbl[2].g = (int)((ctbl[0].g + ctbl[1].g) / 2.);
                ctbl[2].b = (int)((ctbl[0].b + ctbl[1].b) / 2.);
                ctbl[3].r = 0;
                ctbl[3].g = 0;
                ctbl[3].b = 0;
                ctbl[3].a = 0;
            }

            unsigned int t = blocktable[p];

            for (int b = 0; b < 4; b++)
                for (int a = 0; a < 4; a++)
                {
                    image[x * 4 + a + (y * 4 + b) * layout.width] = ctbl[t & 3];
                    t = t >> 2;
                }

            p++;
        }

    delete[] coltable;
    delete[] blocktable;
    return image;
}

std::vector<RGBA> ProcessDXT3(unsigned char* data, const TextureLayout& layout)
{
    DXT1Color* coltable = new DXT1Color[layout.block_count];
    __int64* alphatable = new __int64[layout.block_count];
    unsigned int* blocktable = new unsigned int[layout.block_count];

    unsigned int* d = (unsigned int*)data;

    for (std::size_t x = 0; x < layout.block_count; x++)
    {
        alphatable[x] = ((__int64*)d)[x * 2];
        coltable[x] = *(DXT1Color*)&d[x * 4 + 2];
        blocktable[x] = d[x * 4 + 3];
    }

    std::vector<RGBA> image(layout.pixel_count);
    memset(image.data(), 0, layout.rgba_bytes);

    int p = 0;
    for (int y = 0; y < layout.height / 4; y++)
        for (int x = 0; x < layout.width / 4; x++)
        {
            RGBA ctbl[4];
            memset(ctbl, 255, 16);
            DXT1Color c = coltable[p];
            ctbl[0].r = c.r1 << 3;
            ctbl[0].g = c.g1 << 2;
            ctbl[0].b = c.b1 << 3;
            ctbl[1].r = c.r2 << 3;
            ctbl[1].g = c.g2 << 2;
            ctbl[1].b = c.b2 << 3;

            ctbl[2].r = (int)((ctbl[0].r * 2 + ctbl[1].r) / 3.);
            ctbl[2].g = (int)((ctbl[0].g * 2 + ctbl[1].g) / 3.);
            ctbl[2].b = (int)((ctbl[0].b * 2 + ctbl[1].b) / 3.);
            ctbl[3].r = (int)((ctbl[0].r + ctbl[1].r * 2) / 3.);
            ctbl[3].g = (int)((ctbl[0].g + ctbl[1].g * 2) / 3.);
            ctbl[3].b = (int)((ctbl[0].b + ctbl[1].b * 2) / 3.);

            unsigned int t = blocktable[p];
            __int64 k = alphatable[p];

            for (int b = 0; b < 4; b++)
                for (int a = 0; a < 4; a++)
                {
                    image[x * 4 + a + (y * 4 + b) * layout.width] = ctbl[t & 3];
                    t = t >> 2;
                    image[x * 4 + a + (y * 4 + b) * layout.width].a = (unsigned char)((k & 15) * 17);
                    k = k >> 4;
                }

            p++;
        }

    delete[] coltable;
    delete[] blocktable;
    delete[] alphatable;
    return image;
}

std::vector<RGBA> ProcessDXT5(unsigned char* data, const TextureLayout& layout)
{
    DXT1Color* coltable = new DXT1Color[layout.block_count];
    DXT5Alpha* alphatable = new DXT5Alpha[layout.block_count];
    unsigned int* blocktable = new unsigned int[layout.block_count];

    unsigned int* d = (unsigned int*)data;

    for (std::size_t x = 0; x < layout.block_count; x++)
    {
        alphatable[x] = *(DXT5Alpha*)&(((__int64*)d)[x * 2]);
        coltable[x] = *(DXT1Color*)&d[x * 4 + 2];
        blocktable[x] = d[x * 4 + 3];
    }

    std::vector<RGBA> image(layout.pixel_count);
    memset(image.data(), 0, layout.rgba_bytes);

    int p = 0;
    for (int y = 0; y < layout.height / 4; y++)
        for (int x = 0; x < layout.width / 4; x++)
        {
            RGBA ctbl[4];
            memset(ctbl, 255, 16);
            DXT1Color c = coltable[p];
            ctbl[0].r = c.r1 << 3;
            ctbl[0].g = c.g1 << 2;
            ctbl[0].b = c.b1 << 3;
            ctbl[1].r = c.r2 << 3;
            ctbl[1].g = c.g2 << 2;
            ctbl[1].b = c.b2 << 3;

            ctbl[2].r = (int)((ctbl[0].r * 2 + ctbl[1].r) / 3.);
            ctbl[2].g = (int)((ctbl[0].g * 2 + ctbl[1].g) / 3.);
            ctbl[2].b = (int)((ctbl[0].b * 2 + ctbl[1].b) / 3.);
            ctbl[3].r = (int)((ctbl[0].r + ctbl[1].r * 2) / 3.);
            ctbl[3].g = (int)((ctbl[0].g + ctbl[1].g * 2) / 3.);
            ctbl[3].b = (int)((ctbl[0].b + ctbl[1].b * 2) / 3.);

            unsigned char atbl[8];
            DXT5Alpha l = alphatable[p];

            atbl[0] = l.a0;
            atbl[1] = l.a1;

            if (l.a0 > l.a1)
            {
                for (int z = 0; z < 6; z++)
                    atbl[z + 2] = ((6 - z) * l.a0 + (z + 1) * l.a1) / 7;
            }
            else
            {
                for (int z = 0; z < 4; z++)
                    atbl[z + 2] = ((4 - z) * l.a0 + (z + 1) * l.a1) / 5;
                atbl[6] = 0;
                atbl[7] = 255;
            }

            unsigned int t = blocktable[p];
            __int64 k = alphatable[p].table;

            for (int b = 0; b < 4; b++)
                for (int a = 0; a < 4; a++)
                {
                    image[x * 4 + a + (y * 4 + b) * layout.width] = ctbl[t & 3];
                    t = t >> 2;
                    image[x * 4 + a + (y * 4 + b) * layout.width].a = atbl[k & 7];
                    k = k >> 3;
                }

            p++;
        }

    delete[] coltable;
    delete[] blocktable;
    delete[] alphatable;
    return image;
}

#include <vector>

// DXTA has no colour: it's a single channel of 8-byte interpolated-alpha blocks
// (BC4/DXT5-alpha style). Present the channel as opaque greyscale.
std::vector<RGBA> ProcessDXTA(unsigned char* data, const TextureLayout& layout)
{
    std::vector<RGBA> image(layout.pixel_count);
    memset(image.data(), 0, layout.rgba_bytes);

    const int blocks_per_row = layout.width / 4;
    for (int by = 0; by < layout.height / 4; by++)
        for (int bx = 0; bx < layout.width / 4; bx++)
        {
            unsigned char* blk = data + ((by * blocks_per_row + bx) * 8);
            unsigned char a0 = blk[0], a1 = blk[1], atbl[8];
            atbl[0] = a0;
            atbl[1] = a1;
            if (a0 > a1)
            {
                for (int z = 0; z < 6; z++)
                    atbl[z + 2] = ((6 - z) * a0 + (z + 1) * a1) / 7;
            }
            else
            {
                for (int z = 0; z < 4; z++)
                    atbl[z + 2] = ((4 - z) * a0 + (z + 1) * a1) / 5;
                atbl[6] = 0;
                atbl[7] = 255;
            }

            __int64 k = 0;
            for (int i = 0; i < 6; i++)
                k |= (__int64)blk[2 + i] << (8 * i);

            for (int b = 0; b < 4; b++)
                for (int a = 0; a < 4; a++)
                {
                    const unsigned char v = atbl[k & 7];
                    k = k >> 3;
                    RGBA& p = image[bx * 4 + a + (by * 4 + b) * layout.width];
                    p.r = p.g = p.b = v;
                    p.a = 255;
                }
        }
    return image;
}

DatTexture ProcessImageFile(unsigned char* img, int size)
{
    constexpr int minimum_texture_bytes = 24;
    if (size < minimum_texture_bytes)
    {
        return DatTexture();
    }
    const std::optional<TextureLayout> layout = ReadTextureLayout(img, static_cast<std::size_t>(size));
    if (!layout)
    {
        return DatTexture();
    }

    std::uint32_t id1 = 0;
    std::uint32_t id2 = 0;
    std::memcpy(&id1, img, sizeof(id1));
    std::memcpy(&id2, img + 4, sizeof(id2));

    if (id1 != 'XTTA' && id1 != 'XETA')
    {
        return DatTexture();
    }

    if ((id2 & 0xffffff) != 'TXD')
    {
        return DatTexture();
    }

    int cmptype = static_cast<int>(id2 >> 24);

    SImageDescriptor r;
    r.xres = layout->width;
    r.yres = layout->height;
    r.Data = img;
    r.imageformat = 0xf;
    r.a = size;
    r.b = 6;
    r.c = 0;
    r.block_count = layout->block_count;

    std::vector<RGBA> output(layout->pixel_count);
    r.image = (unsigned char*)output.data();

    std::vector<RGBA> image;

    TextureType tex_type = TextureType::BC1;

    switch (cmptype)
    {
    case '1':
        AtexDecompress((unsigned int*)img, size, 0xf, r, (unsigned int*)output.data());
        image = ProcessDXT1((unsigned char*)output.data(), *layout);
        tex_type = TextureType::BC1;
        break;
    case '2':
    case '3':
    case 'N':
        AtexDecompress((unsigned int*)img, size, 0x11, r, (unsigned int*)output.data());
        image = ProcessDXT3((unsigned char*)output.data(), *layout);
        if (cmptype == 'N')
        {
            tex_type = TextureType::NormalMap;
        }
        else
        {
			tex_type = TextureType::BC3;
        }
        break;
    case '4':
    case '5':
        AtexDecompress((unsigned int*)img, size, 0x13, r, (unsigned int*)output.data());
        image = ProcessDXT5((unsigned char*)output.data(), *layout);
        tex_type = TextureType::BC5;
        break;
    case 'L':
        // DXTL's fourth channel is luminance, not transparency: premultiply the
        // colour by it and leave the texture opaque (skill icons etc. are DXTL).
        AtexDecompress((unsigned int*)img, size, 0x12, r, (unsigned int*)output.data());
        image = ProcessDXT5((unsigned char*)output.data(), *layout);
        for (std::size_t x = 0; x < layout->pixel_count; x++)
        {
            image[x].r = (image[x].r * image[x].a) / 255;
            image[x].g = (image[x].g * image[x].a) / 255;
            image[x].b = (image[x].b * image[x].a) / 255;
            image[x].a = 255;
        }
        tex_type = TextureType::BC5;
        break;
    case 'A':
        AtexDecompress((unsigned int*)img, size, 0x14, r, (unsigned int*)output.data());
        image = ProcessDXTA((unsigned char*)output.data(), *layout);
        tex_type = TextureType::BC5;
        break;
    default:
        return DatTexture();
    }

    return DatTexture(r.xres, r.yres, image, tex_type);
}
