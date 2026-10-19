"""
Builds public/maps/penicuik.json for the Penicuik level (src/town/).

    python convert.py SRC_DIR ../../public/maps/penicuik.json

SRC_DIR holds:
  osm.json         An Overpass API download (`out geom;`) of every highway, building, landuse,
                   leisure, natural, waterway, amenity and barrier way in the box
                   55.8380,-3.2290 to 55.8485,-3.2100.
  t_X_Y.png        AWS Terrain Tiles (terrarium) at zoom 15 covering it, x 16090-16091, y 10228-10230:
                   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/X/Y.png

The level starts on Bracken Wynd by the pond and ends at Mauricewood Primary School's grounds
(its buildings aren't mapped, so they and the playground are traced from aerial photos in
extras.json). No third-party Python packages needed.
"""
import sys, json, math, base64, struct, heapq, os
sys.path.insert(0, os.path.dirname(__file__))
from png import read_png
src, out = sys.argv[1], sys.argv[2]
LAT0, LON0 = 55.84325, -3.2195
HALF = 580
MLAT = 111132.954 - 559.822 * math.cos(2 * math.radians(LAT0))
MLON = 111412.84 * math.cos(math.radians(LAT0))
def xz(lat, lon): return ((lon - LON0) * MLON, -(lat - LAT0) * MLAT)
def latlon(x, z): return (LAT0 - z / MLAT, LON0 + x / MLON)

# --- elevation (terrarium z15 tiles) ---
Z = 15
tiles = {}
for fn in os.listdir(src):
    if fn.startswith('t_') and fn.endswith('.png'):
        _, tx, ty = fn[:-4].split('_')
        w, h, px = read_png(os.path.join(src, fn))
        tiles[(int(tx), int(ty))] = [r * 256 + g + b / 256 - 32768 for r, g, b in px]
def elev_px(gx, gy):
    tx, ty = int(gx // 256), int(gy // 256)
    t = tiles[(tx, ty)]
    return t[int(gy - ty * 256) * 256 + int(gx - tx * 256)]
def elev(lat, lon):
    n = 2 ** Z * 256
    gx = (lon + 180) / 360 * n - 0.5
    gy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n - 0.5
    x0, y0 = math.floor(gx), math.floor(gy)
    fx, fy = gx - x0, gy - y0
    a = elev_px(x0, y0); b = elev_px(x0 + 1, y0); c = elev_px(x0, y0 + 1); d = elev_px(x0 + 1, y0 + 1)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
STEP = 4
N = int(2 * HALF / STEP) + 1
H = [[elev(*latlon(-HALF + i * STEP, -HALF + j * STEP)) for i in range(N)] for j in range(N)]
# A light smoothing: the source is coarser than the grid, so take the steps off it.
for _ in range(2):
    H2 = [row[:] for row in H]
    for j in range(1, N - 1):
        for i in range(1, N - 1):
            H2[j][i] = (H[j][i] * 4 + H[j - 1][i] + H[j + 1][i] + H[j][i - 1] + H[j][i + 1]) / 8
    H = H2
lo = min(min(r) for r in H)
hdata = struct.pack('<%dH' % (N * N), *[int(round((H[j][i] - lo) * 10)) for j in range(N) for i in range(N)])

def hat(x, z):
    gx = (x + HALF) / STEP; gz = (z + HALF) / STEP
    i = max(0, min(N - 2, int(gx))); j = max(0, min(N - 2, int(gz)))
    fx = gx - i; fz = gz - j
    return (H[j][i] * (1 - fx) + H[j][i + 1] * fx) * (1 - fz) + (H[j + 1][i] * (1 - fx) + H[j + 1][i + 1] * fx) * fz - lo

# --- OSM ---
d = json.load(open(os.path.join(src, 'osm.json')))
def pts(e): return [xz(g['lat'], g['lon']) for g in e.get('geometry', [])]
def flat(p): return [round(v, 1) for q in p for v in q]
def inside(p, m=0): return all(abs(x) < HALF - m and abs(z) < HALF - m for x, z in p)
def clip_line(p):
    runs, cur = [], []
    for q in p:
        if abs(q[0]) < HALF - 2 and abs(q[1]) < HALF - 2: cur.append(q)
        else:
            if len(cur) > 1: runs.append(cur)
            cur = []
    if len(cur) > 1: runs.append(cur)
    return runs
ROADW = {'primary': 8, 'secondary': 7.5, 'tertiary': 7, 'unclassified': 6, 'residential': 6, 'living_street': 5, 'service': 4, 'construction': 5,
         'footway': 2, 'path': 1.8, 'cycleway': 2.2, 'steps': 2, 'pedestrian': 3, 'track': 3}
roads, buildings, areas, barriers = [], [], [], []
AREA = {('landuse', 'grass'): 'grass', ('leisure', 'garden'): 'garden', ('natural', 'wood'): 'wood', ('landuse', 'forest'): 'wood', ('natural', 'scrub'): 'scrub',
        ('natural', 'water'): 'water', ('leisure', 'pitch'): 'pitch', ('amenity', 'parking'): 'parking', ('leisure', 'playground'): 'playground',
        ('leisure', 'park'): 'grass', ('landuse', 'recreation_ground'): 'grass', ('natural', 'grassland'): 'grass', ('landuse', 'allotments'): 'allotment',
        ('amenity', 'school'): 'school'}
for e in d['elements']:
    t = e.get('tags', {})
    p = pts(e)
    if len(p) < 2: continue
    if 'highway' in t and t['highway'] in ROADW:
        if t.get('area') == 'yes': continue
        for run in clip_line(p): roads.append({'k': t['highway'], 'w': ROADW[t['highway']], 'n': t.get('name', ''), 'p': flat(run)})
    elif 'building' in t:
        if p[0] == p[-1]: p = p[:-1]
        if len(p) < 3 or not inside(p, 3): continue
        k = t['building']
        k = k if k in ('house', 'garage', 'garages', 'school', 'apartments', 'shed', 'detached', 'carport') else 'yes'
        b = {'k': k, 'p': flat(p)}
        lv = t.get('building:levels')
        if lv:
            try: b['l'] = float(lv)
            except ValueError: pass
        buildings.append(b)
    elif 'barrier' in t and t['barrier'] in ('fence', 'hedge', 'wall', 'retaining_wall'):
        for run in clip_line(p): barriers.append({'k': t['barrier'], 'p': flat(run)})
    elif 'waterway' in t:
        for run in clip_line(p): barriers.append({'k': 'stream', 'p': flat(run)})
    elif t.get('natural') == 'tree_row':
        for run in clip_line(p): barriers.append({'k': 'trees', 'p': flat(run)})
    elif t.get('natural') == 'water' and t.get('intermittent') == 'yes' and p[0] == p[-1]:
        # A drainage basin that's dry most of the time: grass, as in the aerial photos.
        areas.append({'k': 'basin', 'p': flat([(max(-HALF, min(HALF, x)), max(-HALF, min(HALF, z))) for x, z in p[:-1]])})
    else:
        for (kk, vv), name in AREA.items():
            if t.get(kk) == vv and p[0] == p[-1]:
                areas.append({'k': name, 'p': flat([(max(-HALF, min(HALF, x)), max(-HALF, min(HALF, z))) for x, z in p[:-1]])})
                break

# --- hand-traced extras (the school's buildings and playground, trees): see extras.json ---
extras = json.load(open(os.path.join(os.path.dirname(__file__), 'extras.json'), encoding='utf-8'))
for b in extras['school']:
    buildings.append({'k': 'school-' + b['k'], 'p': flat(b['p'])})
for a in extras['areas']:
    areas.append({'k': a['k'], 'p': flat(a['p'])})
for l in extras['lines']:
    barriers.append({'k': l['k'], 'p': flat(l['p'])})

# --- driveways: from each house to the street in front of it ---
DRIVE = {'residential', 'service', 'unclassified', 'tertiary', 'living_street'}
street_segs = [(a, b, r['w']) for r in roads if r['k'] in DRIVE for pp in [list(zip(r['p'][0::2], r['p'][1::2]))] for a, b in zip(pp, pp[1:])]
def near_seg(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz or 1)))
    return (a[0] + dx * t, a[1] + dz * t)
driveways = []
for i, b in enumerate(buildings):
    if b['k'] not in ('house', 'detached', 'garage', 'yes'): continue
    bp = list(zip(b['p'][0::2], b['p'][1::2]))
    c = (sum(x for x, _ in bp) / len(bp), sum(z for _, z in bp) / len(bp))
    best = None
    for a, e, w in street_segs:
        if abs(a[0] - c[0]) > 40 or abs(a[1] - c[1]) > 40: continue
        q = near_seg(c, a, e)
        d = math.dist(q, c) - w / 2
        if best is None or d < best[0]: best = (d, q, w)
    if best is None or best[0] > 20: continue
    d, q, w = best
    k = (math.dist(q, c) - w / 2) / max(1e-6, math.dist(q, c))
    end = (c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k)
    driveways.append([round(c[0], 1), round(c[1], 1), round(end[0], 1), round(end[1], 1), i % 5 < 3 and 1 or 0])

# --- start, school and the road route between them ---
# Start on Bracken Wynd, at its nearest point to the pond
# (snapped to the nearest road point below).
start = xz(55.846512, -3.222186)
sx0 = xz(55.8411, -3.2146)
school_area = min((a for a in areas if a['k'] == 'school'), key=lambda a: math.dist((a['p'][0], a['p'][1]), sx0))
gp = list(zip(school_area['p'][0::2], school_area['p'][1::2]))
def in_poly(q, poly):
    c = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > q[1]) != (z2 > q[1]) and q[0] < x1 + (q[1] - z1) * (x2 - x1) / (z2 - z1): c = not c
    return c
def area(p): return abs(sum(x1 * z2 - x2 * z1 for (x1, z1), (x2, z2) in zip(p, p[1:] + p[:1]))) / 2
# The school's buildings aren't mapped (only its grounds), so they're traced in extras.json: aim for the middle of them.
sp = [q for b in extras['school'] for q in b['p']]
school = (sum(x for x, _ in sp) / len(sp), sum(z for _, z in sp) / len(sp))
print('school grounds area', round(area(gp)), 'm2; buildings inside:', sum(in_poly((b['p'][0], b['p'][1]), gp) for b in buildings))
adj = {}
def key(q): return (round(q[0], 1), round(q[1], 1))
for r in roads:
    pp = list(zip(r['p'][0::2], r['p'][1::2]))
    cost = 1.0 if r['w'] >= 4 else 1.25
    for a, b in zip(pp, pp[1:]):
        ka, kb = key(a), key(b)
        w = math.dist(a, b) * cost
        adj.setdefault(ka, []).append((kb, w))
        adj.setdefault(kb, []).append((ka, w))
def nearest(q): return min(adj, key=lambda k: math.dist(k, q))
s, g = nearest(start), nearest(school)
start = s
dist = {s: 0}; prev = {}; pq = [(0, s)]
while pq:
    dd, u = heapq.heappop(pq)
    if u == g: break
    if dd > dist[u]: continue
    for v, w in adj[u]:
        if dd + w < dist.get(v, 1e18):
            dist[v] = dd + w; prev[v] = u; heapq.heappush(pq, (dd + w, v))
route = [g]
while route[-1] != s: route.append(prev[route[-1]])
route.reverse()
deg = {k: len(v) for k, v in adj.items()}
junctions = [q for q in route if deg[q] >= 3]
print('start', [round(v) for v in start], 'h', round(hat(*start), 1), ' school', [round(v) for v in school], 'h', round(hat(*school), 1))
print('route length', round(sum(math.dist(a, b) for a, b in zip(route, route[1:]))), 'm,', len(route), 'pts,', len(junctions), 'junctions')
print('heights lo', round(lo, 1), 'hi', round(max(max(r) for r in H), 1))
print(len(roads), 'roads', len(buildings), 'buildings', len(areas), 'areas', len(barriers), 'barriers')
json.dump({
    'source': 'OpenStreetMap contributors (ODbL); elevation from AWS Terrain Tiles (Mapzen terrarium)',
    'origin': [LAT0, LON0], 'half': HALF, 'step': STEP, 'n': N, 'base': round(lo, 1),
    'heights': base64.b64encode(hdata).decode(),
    'start': [round(v, 1) for v in start], 'school': [round(v, 1) for v in school], 'schoolGrounds': school_area['p'],
    'route': flat(route), 'junctions': flat(junctions),
    'roads': roads, 'buildings': buildings, 'areas': [a for a in areas if a is not school_area] + [school_area], 'barriers': barriers,
    'trees': extras['trees'], 'driveways': driveways,
}, open(out, 'w'), separators=(',', ':'))
print('wrote', os.path.getsize(out), 'bytes')
