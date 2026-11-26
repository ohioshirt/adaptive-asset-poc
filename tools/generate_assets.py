"""Generate original synthetic RGBA clips and looping PCM tones. Requires Pillow, FFmpeg."""
from pathlib import Path
from PIL import Image, ImageDraw
import math, wave, struct, tempfile, subprocess

OUT = Path(__file__).resolve().parents[1] / 'demo' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
W = H = 192
S = 3
FRAMES = 13
# Mouth curvature and eyebrow tilt. The last frame of each atlas is the exact stable pose.
POSES = {'neutral': (0,0), 'smile': (13,-2), 'concern':(-9,8)}

def frame(a,b,t):
    t=t*t*(3-2*t)
    curve, brow = [x+(y-x)*t for x,y in zip(POSES[a],POSES[b])]
    im=Image.new('RGBA',(W*S,H*S)); d=ImageDraw.Draw(im)
    def ellipse(xy,fill,outline=None,width=1):
        d.ellipse(tuple(round(x*S) for x in xy),fill=fill,outline=outline,width=width*S)
    def line(points,fill,width=3):
        d.line([(round(x*S),round(y*S)) for x,y in points],fill=fill,width=width*S,joint='curve')
    def poly(points,fill):
        d.polygon([(round(x*S),round(y*S)) for x,y in points],fill=fill)
    # original stylized robot, transparent canvas
    ellipse((37,22,155,148),'#35445c','#111b2b',3)
    ellipse((44,33,148,142),'#a9d8e8','#192b42',2)
    for x in (37,155):
        ellipse((x-11,69,x+11,108),'#647b9b','#17273c',2)
        ellipse((x-4,82,x+4,95),'#59ebd7')
    poly([(47,157),(72,140),(120,140),(145,157),(158,184),(34,184)],'#344762')
    poly([(74,146),(96,161),(118,146),(110,177),(82,177)],'#6d88ab')
    ellipse((64,75,83,96),'#162539');ellipse((109,75,128,96),'#162539')
    ellipse((69,79,74,84),'#f5ffff');ellipse((114,79,119,84),'#f5ffff')
    line([(62,67-brow),(83,67+brow)],'#233c58')
    line([(109,67+brow),(130,67-brow)],'#233c58')
    line([(x,115+curve*(1-((x-96)/17)**2)) for x in range(79,114)],'#263e53',3)
    ellipse((89,14,103,28),'#59ebd7','#162539',2)
    return im.resize((W,H),Image.Resampling.LANCZOS)

for a in POSES:
    frame(a,a,0).save(OUT/f'{a}.png')
    for b in POSES:
        if a==b: continue
        frames=[frame(a,b,i/(FRAMES-1)) for i in range(FRAMES)]
        atlas=Image.new('RGBA',(W*FRAMES,H))
        for i,f in enumerate(frames): atlas.paste(f,(i*W,0))
        atlas.save(OUT/f'{a}_{b}.png',optimize=True)
        # 12 samples at 20fps cover [0,600ms); stable endpoint lives in b.png.
        with tempfile.TemporaryDirectory() as tmp:
            for i,f in enumerate(frames[:-1]): f.save(Path(tmp)/f'{i:03}.png')
            subprocess.run(['ffmpeg','-loglevel','error','-y','-framerate','20','-i',f'{tmp}/%03d.png','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-b:v','0','-crf','24',str(OUT/f'{a}_{b}.webm')],check=True)

# Two 2-second loops, all partials complete integer cycles. No external music/assets.
for name, tones in [('calm',[(110,.09),(165,.05),(220,.025)]),('alert',[(110,.08),(156,.07),(233,.035)])]:
    rate=24000; length=rate*2
    with wave.open(str(OUT/f'{name}.wav'),'wb') as f:
        f.setparams((1,2,rate,length,'NONE','not compressed'))
        samples=[]
        for i in range(length):
            t=i/rate
            envelope=.68+.32*math.cos(2*math.pi*t*(1 if name=='calm' else 4))
            val=envelope*sum(amp*math.sin(2*math.pi*hz*t) for hz,amp in tones)
            samples.append(round(val*32767))
        f.writeframes(struct.pack(f'<{length}h',*samples))
