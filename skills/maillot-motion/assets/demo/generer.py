# Génère les maillots de démonstration (aucun club, aucune marque) :
#   python3 assets/demo/generer.py assets/demo
import sys, os
OUT = sys.argv[1]
BODY = ("M400,62 C430,112 570,112 600,62 L700,88 C760,110 830,170 905,292 L828,392 "
        "C790,365 755,345 724,332 L738,1018 C600,1046 400,1046 262,1018 L276,332 "
        "C245,345 210,365 172,392 L95,292 C170,170 240,110 300,88 Z")
BACK_NECK = "M400,62 C440,84 560,84 600,62"
FRONT_NECK = "M400,62 C430,112 570,112 600,62"

def svg(base, trim, pattern, back=False, sash=None, crest=True):
    neck = BACK_NECK if back else FRONT_NECK
    body = BODY.replace(FRONT_NECK, neck) if back else BODY
    pat = ""
    if pattern == "stripes":
        pat = "".join(f'<rect x="{x}" y="0" width="34" height="1100" fill="{trim[1]}" opacity="0.55"/>' for x in range(268, 740, 96))
    elif pattern == "chevron":
        pat = "".join(f'<path d="M240,{y} L500,{y+90} L760,{y}" stroke="{trim[1]}" stroke-width="14" fill="none" opacity="0.5"/>' for y in range(380, 1040, 70))
    if sash:
        pat += f'<path d="M180,250 L330,250 L820,1060 L670,1060 Z" fill="{sash}"/>'
    crest_svg = ""
    if crest and not back:
        crest_svg = (f'<g transform="translate(598,236)"><path d="M0,0 L70,0 L70,46 C70,80 46,98 35,104 C24,98 0,80 0,46 Z" '
                     f'fill="{trim[0]}" stroke="{trim[2]}" stroke-width="5"/>'
                     f'<path d="M35,22 L41.5,37 L57,38 L45,48 L49,64 L35,55 L21,64 L25,48 L13,38 L28.5,37 Z" fill="{trim[2]}"/></g>'
                     f'<rect x="318" y="262" width="92" height="30" rx="6" fill="{trim[0]}" opacity="0.9"/>')
    collar = (f'<path d="{neck}" stroke="{trim[0]}" stroke-width="26" fill="none" stroke-linecap="round"/>')
    cuffs = (f'<path d="M905,292 L828,392" stroke="{trim[0]}" stroke-width="30"/>'
             f'<path d="M95,292 L172,392" stroke="{trim[0]}" stroke-width="30"/>'
             f'<path d="M886,268 L806,374" stroke="{trim[2]}" stroke-width="7" opacity="0.8"/>'
             f'<path d="M114,268 L194,374" stroke="{trim[2]}" stroke-width="7" opacity="0.8"/>')
    side = (f'<path d="M276,332 L262,1018 C285,1023 300,1026 318,1028 L320,345 Z" fill="#000" opacity="0.18"/>'
            f'<path d="M724,332 L738,1018 C715,1023 700,1026 682,1028 L680,345 Z" fill="#000" opacity="0.18"/>')
    hem = f'<path d="M262,1018 C400,1046 600,1046 738,1018" stroke="{trim[0]}" stroke-width="14" fill="none"/>'
    folds = ('<g filter="url(#soft)" fill="none" stroke-linecap="round">'
             '<path d="M380,420 C420,600 400,780 430,960" stroke="#000" stroke-width="22" opacity="0.10"/>'
             '<path d="M610,380 C580,560 620,760 590,980" stroke="#000" stroke-width="26" opacity="0.10"/>'
             '<path d="M470,300 C520,520 480,700 520,900" stroke="#fff" stroke-width="30" opacity="0.07"/>'
             '<path d="M300,140 C380,170 430,230 450,300" stroke="#fff" stroke-width="18" opacity="0.10"/>'
             '</g>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1100" viewBox="0 0 1000 1100">
<defs>
<clipPath id="j"><path d="{body}"/></clipPath>
<linearGradient id="shade" x1="0" x2="1" y1="0" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0.38"/><stop offset="0.22" stop-color="#000" stop-opacity="0"/>
<stop offset="0.5" stop-color="#fff" stop-opacity="0.06"/><stop offset="0.78" stop-color="#000" stop-opacity="0"/>
<stop offset="1" stop-color="#000" stop-opacity="0.42"/></linearGradient>
<linearGradient id="top" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/>
<stop offset="0.4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.22"/></linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<g clip-path="url(#j)">
<rect width="1000" height="1100" fill="{base}"/>{pat}{side}{folds}
<rect width="1000" height="1100" fill="url(#shade)"/><rect width="1000" height="1100" fill="url(#top)"/>
{cuffs}{hem}
</g>
{collar}{crest_svg}
</svg>
'''

os.makedirs(OUT, exist_ok=True)
kits = {
  "domicile": dict(base="#123f96", trim=("#f2c230", "#1d55c4", "#0b1f4d"), pattern="stripes"),
  "exterieur": dict(base="#f1f0ec", trim=("#123f96", "#dddcd6", "#f1f0ec"), pattern=None, sash="#c8102e"),
  "third": dict(base="#141518", trim=("#d8ff3c", "#2a2c31", "#141518"), pattern="chevron"),
}
for name, k in kits.items():
    for back in (False, True):
        fn = f"maillot-{name}-{'dos' if back else 'face'}.svg"
        with open(os.path.join(OUT, fn), "w") as f:
            f.write(svg(back=back, **k))
        print(fn)
