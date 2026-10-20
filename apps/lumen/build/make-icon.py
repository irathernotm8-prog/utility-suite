# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os
S=4; N=1024*S
def squircle(size, inset, n=4.4):
    m=Image.new('L',(size,size),0); r=(size-2*inset)/2; c=size/2; pts=[]
    for i in range(720):
        t=i/720*2*math.pi; x=math.cos(t); y=math.sin(t)
        pts.append((c+r*math.copysign(abs(x)**(2/n),x), c+r*math.copysign(abs(y)**(2/n),y)))
    ImageDraw.Draw(m).polygon(pts,fill=255); return m
mask=squircle(N,int(N*0.07))
g=Image.linear_gradient('L').resize((N,N))
top=(104,214,255); bot=(24,184,160)
grad=Image.merge('RGBA',[g.point(lambda v,a=a,b=b:int(a+(b-a)*v/255)) for a,b in zip(top+(255,),bot+(255,))])
hl=Image.new('RGBA',(N,N),(0,0,0,0)); ImageDraw.Draw(hl).ellipse((-N*.2,-N*.5,N*1.2,N*.45),fill=(255,255,255,46))
grad=Image.alpha_composite(grad,hl.filter(ImageFilter.GaussianBlur(N*.04)))
gl=Image.new('RGBA',(N,N),(0,0,0,0)); d=ImageDraw.Draw(gl)
cx=cy=N/2; R=N*0.265; w=N*0.075; box=(cx-R,cy-R,cx+R,cy+R)
d.arc(box,start=-20,end=290,fill=(255,255,255,255),width=int(w))
for ang in (-20,-70):
    a=math.radians(ang); rr=R-w/2; x=cx+rr*math.cos(a); y=cy+rr*math.sin(a)
    d.ellipse((x-w/2,y-w/2,x+w/2,y+w/2),fill=(255,255,255,255))
bw=N*0.062; gap=N*0.052; x0=cx-(3*bw+2*gap)/2; base=cy+N*0.105
for i,h in enumerate((0.10,0.17,0.25)):
    x=x0+i*(bw+gap); d.rounded_rectangle((x,base-N*h,x+bw,base),radius=bw/2,fill=(255,255,255,255 if i==2 else 235))
lx=cx+R*math.cos(math.radians(-45))*1.02; ly=cy+R*math.sin(math.radians(-45))*1.02
dot=Image.new('RGBA',(N,N),(0,0,0,0)); dr=N*0.05
ImageDraw.Draw(dot).ellipse((lx-dr,ly-dr,lx+dr,ly+dr),fill=(255,255,255,255))
glow=dot.filter(ImageFilter.GaussianBlur(N*.03))
sh=Image.new('RGBA',(N,N),(0,0,0,0)); sh.paste((8,70,80,120),mask=ImageChops.add(gl.split()[3],dot.split()[3]))
sh=ImageChops.offset(sh.filter(ImageFilter.GaussianBlur(N*.012)),0,int(N*.012))
out=Image.alpha_composite(grad,sh)
for layer in (glow,gl,dot): out=Image.alpha_composite(out,layer)
rim=ImageChops.subtract(mask,mask.filter(ImageFilter.MinFilter(int(N*.004)*2+1)))
out.putalpha(mask)
rl=Image.new('RGBA',(N,N),(255,255,255,22)); rl.putalpha(rim.point(lambda v:v*22//255)); out=Image.alpha_composite(out,rl)
out.resize((1024,1024),Image.LANCZOS).save(os.path.join(os.path.dirname(__file__),'icon.png'))
