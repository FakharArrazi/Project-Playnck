(function(){
  try{
    var THEME_BG={
      dark:{"--bg":"#0c0c11","--panel":"#131319","--elevated":"#1c1c25","--elevated-hover":"#24242f",
            "--border":"#232330","--text":"#f2f2f6","--text-dim":"#96969f","--text-faint":"#5c5c66"},
      light:{"--bg":"#f2efe9","--panel":"#fbfaf7","--elevated":"#ece8e0","--elevated-hover":"#e2ddd2",
             "--border":"#dcd6c9","--text":"#211f1c","--text-dim":"#6e6a62","--text-faint":"#a09a8d"},
      pitchblack:{"--bg":"#000000","--panel":"#000000","--elevated":"#141414","--elevated-hover":"#1e1e1e",
                  "--border":"#242424","--text":"#f2f2f6","--text-dim":"#96969f","--text-faint":"#5c5c66"},
      midnight:{"--bg":"#0b1324","--panel":"#0e192d","--elevated":"#15233b","--elevated-hover":"#1b2c48",
                "--border":"#223653","--text":"#edf4ff","--text-dim":"#a4b2c8","--text-faint":"#677892"},
      graphite:{"--bg":"#1b1d20","--panel":"#202226","--elevated":"#292c31","--elevated-hover":"#34383e",
                 "--border":"#3b3f46","--text":"#f1f2f4","--text-dim":"#afb2b8","--text-faint":"#777b83"},
      forest:{"--bg":"#10231d","--panel":"#142b23","--elevated":"#1b382d","--elevated-hover":"#244737",
              "--border":"#305343","--text":"#edf7f0","--text-dim":"#a7c0b0","--text-faint":"#6f8d7c"}
    };
    var THEME_ACCENT={
      blue:{a1:"#5865f2",a2:"#8a5cf6",rgb:"88,101,242"},
      red:{a1:"#ef4444",a2:"#f87171",rgb:"239,68,68"},
      orange:{a1:"#f97316",a2:"#fb923c",rgb:"249,115,22"},
      green:{a1:"#22c55e",a2:"#4ade80",rgb:"34,197,94"},
      purple:{a1:"#a855f7",a2:"#c084fc",rgb:"168,85,247"},
      yellow:{a1:"#eab308",a2:"#facc15",rgb:"234,179,8"},
      pink:{a1:"#ec4899",a2:"#f472b6",rgb:"236,72,153"},
      teal:{a1:"#14b8a6",a2:"#2dd4bf",rgb:"20,184,166"},
      indigo:{a1:"#6366f1",a2:"#818cf8",rgb:"99,102,241"},
      cyan:{a1:"#06b6d4",a2:"#22d3ee",rgb:"6,182,212"},
      lime:{a1:"#84cc16",a2:"#a3e635",rgb:"132,204,22"},
      rose:{a1:"#f43f5e",a2:"#fb7185",rgb:"244,63,94"}
    };
    var raw=localStorage.getItem("playnck-theme-cache");
    if(!raw) return;
    var cached=JSON.parse(raw);
    var bg=THEME_BG[cached.bg]||THEME_BG.pitchblack;
    var ac=THEME_ACCENT[cached.accent]||THEME_ACCENT.blue;
    var root=document.documentElement.style;
    for(var k in bg) root.setProperty(k,bg[k]);
    root.setProperty("--accent1",ac.a1);
    root.setProperty("--accent2",ac.a2);
    root.setProperty("--accent1-rgb",ac.rgb);
  }catch(e){   }
})();
