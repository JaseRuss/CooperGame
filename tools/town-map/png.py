import zlib, struct
def read_png(path):
    data = open(path,'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8; idat = b''; w=h=ct=None; plte=None
    while pos < len(data):
        ln, = struct.unpack('>I', data[pos:pos+4]); typ = data[pos+4:pos+8]; body = data[pos+8:pos+8+ln]; pos += 12+ln
        if typ == b'IHDR': w,h,bd,ct,_,_,il = struct.unpack('>IIBBBBB', body); assert bd==8 and il==0
        elif typ == b'PLTE': plte = body
        elif typ == b'IDAT': idat += body
    bpp = {2:3,6:4,3:1,0:1}[ct]
    raw = zlib.decompress(idat); stride = w*bpp; out = bytearray(); prev = bytearray(stride); p = 0
    for _ in range(h):
        f = raw[p]; line = bytearray(raw[p+1:p+1+stride]); p += 1+stride
        for i in range(stride):
            a = line[i-bpp] if i>=bpp else 0; b = prev[i]; c = prev[i-bpp] if i>=bpp else 0
            if f==1: line[i]=(line[i]+a)&255
            elif f==2: line[i]=(line[i]+b)&255
            elif f==3: line[i]=(line[i]+((a+b)>>1))&255
            elif f==4:
                pa=abs(b-c); pb=abs(a-c); pc=abs(a+b-2*c)
                pr = a if pa<=pb and pa<=pc else (b if pb<=pc else c)
                line[i]=(line[i]+pr)&255
        out += line; prev = line
    px = []
    for i in range(w*h):
        if ct==3:
            k=out[i]; px.append(tuple(plte[k*3:k*3+3]))
        else: px.append(tuple(out[i*bpp:i*bpp+3]))
    return w,h,px
