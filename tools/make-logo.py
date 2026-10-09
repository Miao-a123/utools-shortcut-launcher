import struct, zlib

S = 512          # supersampled canvas
F = 4            # downscale factor
N = S // F       # final 128

BG = (83, 74, 183)        # purple 600
TILE = (255, 255, 255)
TILE_SOFT = (206, 203, 246)  # purple 100


def inside_rrect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


pad = 20 * F
inner = S - pad * 2
gap = 6 * F
cell = (inner - gap * 2) / 3.0

tiles = []
big = cell * 2 + gap
tiles.append((pad, pad, pad + big, pad + big, 6 * F, TILE))
for c in (2,):
    for r in (0, 1):
        x0 = pad + c * (cell + gap)
        y0 = pad + r * (cell + gap)
        tiles.append((x0, y0, x0 + cell, y0 + cell, 4 * F, TILE_SOFT))
for c in (0, 1, 2):
    x0 = pad + c * (cell + gap)
    y0 = pad + 2 * (cell + gap)
    tiles.append((x0, y0, x0 + cell, y0 + cell, 4 * F, TILE_SOFT))

rows = []
for y in range(S):
    row = bytearray()
    for x in range(S):
        px = (0, 0, 0, 0)
        if inside_rrect(x, y, 0, 0, S - 1, S - 1, 28 * F):
            px = (BG[0], BG[1], BG[2], 255)
            for (x0, y0, x1, y1, r, col) in tiles:
                if inside_rrect(x, y, x0, y0, x1, y1, r):
                    px = (col[0], col[1], col[2], 255)
                    break
        row += bytes(px)
    rows.append(row)

out = bytearray()
stride = S * 4
for y in range(N):
    out.append(0)
    for x in range(N):
        r = g = b = a = 0
        for dy in range(F):
            base = x * F * 4
            src = rows[y * F + dy]
            for dx in range(F):
                o = base + dx * 4
                r += src[o]
                g += src[o + 1]
                b += src[o + 2]
                a += src[o + 3]
        n = F * F
        out += bytes((r // n, g // n, b // n, a // n))

raw = bytes(out)


def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))


png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(raw, 9))
png += chunk(b'IEND', b'')

with open(r'E:/imo/WorkBuddy/2026-10-08-22-48-54/utools-shortcut-launcher/logo.png', 'wb') as f:
    f.write(png)
print('logo.png written', len(png), 'bytes', N, 'x', N)
