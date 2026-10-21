# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A branching chart on deep indigo: one path is traced in a violet-to-cyan glow, the other branches stay dim.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os
S=4; N=1024*S
def squircle(size, inset, n=4.4):
    m=Image.new('L',(size,size),0); r=(size-2*inset)/2; c=size/2; pts=[]
    for i in range(720):
        t=i/720*2*math.pi; x=math.cos(t); y=math.sin(t)
        pts.append((c+r*math.copysign(abs(x)**(2/n),x), c+r*math.copysign(abs(y)**(2/n),y)))
    ImageDraw.Draw(m).polygon(pts,fill=255); return m
mask=squircle(N,int(N*0.085))
g=Image.linear_gradient('L').resize((N,N))
top=(36,30,72); bot=(10,12,28)
bg=Image.merge('RGBA',[g.point(lambda v,a=a,b=b:int(a+(b-a)*v/255)) for a,b in zip(top+(255,),bot+(255,))])
hl=Image.new('RGBA',(N,N),(0,0,0,0)); ImageDraw.Draw(hl).ellipse((-N*.1,-N*.55,N*1.1,N*.42),fill=(150,130,255,34))
bg=Image.alpha_composite(bg,hl.filter(ImageFilter.GaussianBlur(N*.06)))
def P(x,y): return (x*N/1024,y*N/1024)
# nodes (x,y) in 1024 space
dx=-44
A=(512+dx,296); B=(322+dx,516); C=(702+dx,516); D=(612+dx,738); E=(800+dx,738); F=(322+dx,738)
W=int(N*0.034)
def elbow(d,a,b,fill,w):
    mid=(a[1]+b[1])/2
    pts=[P(*a),P(a[0],mid),P(b[0],mid),P(*b)]
    d.line(pts,fill=fill,width=w,joint='curve')
    for p in pts: d.ellipse((p[0]-w/2,p[1]-w/2,p[0]+w/2,p[1]+w/2),fill=fill)
dim=Image.new('RGBA',(N,N),(0,0,0,0)); dd=ImageDraw.Draw(dim)
for a,b in ((A,B),(B,F),(C,E)): elbow(dd,a,b,(255,255,255,70),W)
def node(d,c,r,fill):
    x,y=P(*c); rr=r*N/1024; d.rounded_rectangle((x-rr,y-rr*0.78,x+rr,y+rr*0.78),radius=rr*0.42,fill=fill)
for c in (B,F,E): node(dd,c,62,(255,255,255,80))
# traced path A -> C -> D with gradient
tr=Image.new('L',(N,N),0); td=ImageDraw.Draw(tr)
elbow(td,A,C,255,int(W*1.25)); elbow(td,C,D,255,int(W*1.25))
for c,r in ((A,78),(C,70),(D,70)): node(td,c,r,255)
gx=Image.linear_gradient('L').rotate(-35,expand=False).resize((N,N))
c0=(176,140,255); c1=(80,220,255)
grad=Image.merge('RGB',[gx.point(lambda v,a=a,b=b:int(a+(b-a)*v/255)) for a,b in zip(c0,c1)]).convert('RGBA')
path=Image.new('RGBA',(N,N),(0,0,0,0)); path.paste(grad,mask=tr)
glow=Image.new('RGBA',(N,N),(0,0,0,0)); glow.paste(grad,mask=tr.filter(ImageFilter.GaussianBlur(N*.03)))
# inner dots on traced nodes
dots=Image.new('RGBA',(N,N),(0,0,0,0)); dt=ImageDraw.Draw(dots)
for c,r in ((A,22),(C,19),(D,19)):
    x,y=P(*c); rr=r*N/1024; dt.ellipse((x-rr,y-rr,x+rr,y+rr),fill=(18,16,40,235))
# current-node ring on D
ring=Image.new('RGBA',(N,N),(0,0,0,0)); rd=ImageDraw.Draw(ring); x,y=P(*D); rr=112*N/1024
rd.rounded_rectangle((x-rr,y-rr*0.8,x+rr,y+rr*0.8),radius=rr*0.45,outline=(120,225,255,90),width=int(N*0.008))
sh=Image.new('RGBA',(N,N),(0,0,0,0)); sh.paste((0,0,0,140),mask=tr)
sh=ImageChops.offset(sh.filter(ImageFilter.GaussianBlur(N*.014)),0,int(N*.014))
out=bg
for layer in (dim,sh,glow,glow,path,dots,ring): out=Image.alpha_composite(out,layer)
rim=ImageChops.subtract(mask,mask.filter(ImageFilter.MinFilter(int(N*.004)*2+1)))
out.putalpha(mask)
rl=Image.new('RGBA',(N,N),(255,255,255,30)); rl.putalpha(rim.point(lambda v:v*30//255)); out=Image.alpha_composite(out,rl)
out.resize((1024,1024),Image.LANCZOS).save(os.path.join(os.path.dirname(os.path.abspath(__file__)),'icon.png'))
