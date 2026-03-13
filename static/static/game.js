/* ── DOM ─────────────────────────────────────────────────────────────────── */
const canvas      = document.getElementById("game")
const ctx         = canvas.getContext("2d")
const btnStart    = document.getElementById("btnStart")
const btnSingle   = document.getElementById("btnSingle")
const btnMulti    = document.getElementById("btnMulti")
const inputName   = document.getElementById("playerName")
const inputRoom   = document.getElementById("roomId")
const menu        = document.getElementById("menu")
const gameUI      = document.getElementById("game-ui")
const btnBack     = document.getElementById("btnBack")
const roomDisplay = document.getElementById("roomDisplay")
const multiPanel  = document.getElementById("multiPanel")
const btnCreate   = document.getElementById("btnCreate")
const btnJoin     = document.getElementById("btnJoin")
const roomStatus  = document.getElementById("roomStatus")

/* ── CONFIG ──────────────────────────────────────────────────────────────── */
const CFG = {
  MAP:    { COLS:12, ROWS:8, CELL:90 },
  TANK:   { SIZE:26, SPEED:2, ROT:0.055 },
  BULLET: { SPEED:5, RADIUS:4, BOUNCES:15, COOLDOWN:480 },
}

/* ── GLOBAL STATE ────────────────────────────────────────────────────────── */
let mode      = "single"   // "single" | "multi"
let myId      = "player"   // socket.id trong multi, "player" trong single
let myRoom    = null
let mySlot    = 0          // 0 = host (xanh, góc TL), 1 = joiner (đỏ, góc BR)
let players   = {}         // { id: playerObj }
let bullets   = []
let maze      = []
let keys      = {}
let lastShot  = 0
let loopRunning = false
let socket    = null
let gameOver  = false      // true khi ván kết thúc

/* ── ROOM SETTINGS ───────────────────────────────────────────────────────── */
let roomSettings = {
  maze_complexity: 100,   // 0=rất trống, 100=mê cung đầy đủ
  game_mode:       "infinite",  // "score" | "infinite"
  score_limit:     10,
}

/* ── PARTICLES ───────────────────────────────────────────────────────────── */
let particles = []

function spawnExplosion(x, y, color) {
  const cc = [color, "#333", "#555", "#222"]
  for (let i = 0; i < 6; i++) {
    const a = Math.random()*Math.PI*2, s = 1+Math.random()*2
    particles.push({type:"flash", x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s,
      life:1, decay:0.08, r:10+Math.random()*8})
  }
  for (let i = 0; i < 14; i++) {
    const a = Math.random()*Math.PI*2, s = 1.5+Math.random()*4.5
    particles.push({type:"chunk", x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s,
      life:1, decay:0.018+Math.random()*0.012,
      size:3+Math.random()*7, rot:Math.random()*Math.PI*2,
      rotSpd:(Math.random()-.5)*.3,
      color:cc[Math.floor(Math.random()*cc.length)]})
  }
  for (let i = 0; i < 20; i++) {
    const a = Math.random()*Math.PI*2, s = 2+Math.random()*6
    particles.push({type:"spark", x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s,
      life:1, decay:0.04+Math.random()*.04,
      color:Math.random()<.5?"#ff8c00":"#ffdd00"})
  }
  for (let i = 0; i < 8; i++) {
    const a = Math.random()*Math.PI*2, s = .3+Math.random()*1.2
    particles.push({type:"smoke", x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s-.5,
      life:1, decay:0.012, r:8+Math.random()*10})
  }
}

function updateParticles() {
  particles = particles.filter(p => {
    p.x+=p.vx; p.y+=p.vy; p.vy+=.08; p.vx*=.96; p.vy*=.96; p.life-=p.decay
    if (p.type==="chunk") p.rot+=p.rotSpd
    return p.life > 0
  })
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save(); ctx.globalAlpha = Math.max(0, p.life)
    if (p.type==="flash") {
      const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r)
      g.addColorStop(0,"rgba(255,200,80,.9)"); g.addColorStop(1,"rgba(255,80,0,0)")
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill()
    } else if (p.type==="chunk") {
      ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillStyle=p.color
      ctx.fillRect(-p.size/2,-p.size/3,p.size,p.size*.6)
    } else if (p.type==="spark") {
      ctx.strokeStyle=p.color; ctx.lineWidth=1.5; ctx.lineCap="round"
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x-p.vx*3,p.y-p.vy*3); ctx.stroke()
    } else if (p.type==="smoke") {
      const sr = p.r*(1+.8*(1-p.life))
      const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,sr)
      g.addColorStop(0,"rgba(80,80,80,.35)"); g.addColorStop(1,"rgba(60,60,60,0)")
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,sr,0,Math.PI*2); ctx.fill()
    }
    ctx.restore()
  })
}

/* ── GIFTS ───────────────────────────────────────────────────────────────── */
let gifts = [], giftTimer = 0
const GIFT_SPAWN_SECONDS = 10   // ← chỉnh thời gian (giây) giữa mỗi lần spawn gift
const FPS = 60
let GIFT_IV = GIFT_SPAWN_SECONDS * FPS   // tính frame từ giây, override theo complexity nếu cần
let GIFT_R = 14

function spawnGift() {
  const C = CFG.MAP.CELL
  // Spawn hoàn toàn random trên map, không lọc theo khoảng cách player
  const cx = 1 + Math.floor(Math.random() * (CFG.MAP.COLS - 2))
  const cy = 1 + Math.floor(Math.random() * (CFG.MAP.ROWS - 2))
  const gx = cx * C + C / 2
  const gy = cy * C + C / 2
  const _r = Math.random()
  const _t = _r<0.24?1:_r<0.48?2:_r<0.66?3:_r<0.84?4:5
  gifts.push({x:gx, y:gy, type:_t, pulse:0})
}

function updateGifts() {
  giftTimer++
  if (giftTimer>=GIFT_IV) {  // không giới hạn số lượng gift
    giftTimer=0
    // Multi: chỉ slot 0 (host) spawn gift, rồi emit để joiner biết
    if (mode==="single"||mySlot===0) {
      spawnGift()
      if (mode==="multi"&&socket&&myRoom) {
        const g=gifts[gifts.length-1]
        socket.emit("gift_spawn",{room:myRoom,x:g.x,y:g.y,gtype:g.type})
      }
    }
  }
  gifts.forEach(g => g.pulse+=.06)
  for (const pid in players) {
    const p = players[pid]; if (p.alive===false) continue
    gifts = gifts.filter(g => {
      if (Math.hypot(p.x-g.x,p.y-g.y) < GIFT_R+CFG.TANK.SIZE/2) {
        // Multi: chỉ người nhặt (pid===myId) xử lý pickup
        if (mode==="single"||pid===myId) {
          if (g.type===3) {
            fakeBombTimers[pid] = {timer:180, countdown:3}
            spawnPickupFX(g.x,g.y,3)
          } else {
            p.power=g.type
            // type 5 rocket: không có powerTimer — chỉ mất khi bắn
            if (g.type!==5) p.powerTimer=600
            spawnPickupFX(g.x,g.y,g.type)
          }
          if (mode==="multi"&&socket&&myRoom)
            socket.emit("gift_pickup",{room:myRoom,gx:g.x,gy:g.y,pid,gtype:g.type})
        }
        return false
      }
      return true
    })
  }
  for (const pid in players) {
    const p = players[pid]
    if ((p.powerTimer||0)>0 && p.power!==5) { p.powerTimer--; if (p.powerTimer<=0) { p.power=0; if(mode==="multi"&&socket&&myRoom&&pid===myId) socket.emit("power_clear",{room:myRoom,pid}) } }
  }
}

function spawnPickupFX(x, y, gt) {
  const col = gt===1?"#00ffcc":gt===2?"#ff44ff":gt===3?"#ff4444":gt===4?"#cc44ff":"#ff8800"
  for (let i=0; i<16; i++) {
    const a=Math.random()*Math.PI*2, s=1+Math.random()*3
    particles.push({type:"spark",x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
      life:1,decay:.03,color:col})
  }
}

function drawGifts() {
  const now = Date.now()
  gifts.forEach(g => {
    const pulse = Math.sin(g.pulse)*.25+.9
    // Màu theo loại: 1=xanh ngọc, 2=tím, 3=đỏ(fake), 4=tím đậm(purple bullet)
    const GC = {
      1:[0,220,180],  2:[180,0,255],
      3:[255,60,60],  4:[140,0,230], 5:[255,140,0]
    }
    const CC = {1:"#00ddbb",2:"#c000ff",3:"#ff3333",4:"#9900ff",5:"#ff8800"}
    const gc = GC[g.type]||GC[1], cc = CC[g.type]||CC[1]
    const label = {1:"L1",2:"L2",3:"💣",4:"⚡",5:"🚀"}[g.type]||"?"
    const sublabel = {1:"SIGHT",2:"LASER",3:"FAKE",4:"VOID",5:"ROCKET"}[g.type]||""
    const subcolor = {1:"#aaffee",2:"#f0aaff",3:"#ffaaaa",4:"#ddaaff",5:"#ffcc88"}[g.type]||"#fff"
    ctx.save(); ctx.translate(g.x,g.y)
    const gr = (GIFT_R+8)*pulse
    const grd = ctx.createRadialGradient(0,0,2,0,0,gr)
    grd.addColorStop(0,`rgba(${gc[0]},${gc[1]},${gc[2]},.55)`)
    grd.addColorStop(1,`rgba(${gc[0]},${gc[1]},${gc[2]},0)`)
    ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(0,0,gr,0,Math.PI*2); ctx.fill()
    ctx.save(); ctx.rotate(now*.002*(g.type===2?1.4:g.type===4?2:1))
    ctx.strokeStyle=cc; ctx.lineWidth=2; ctx.globalAlpha=.7; ctx.setLineDash([6,5])
    ctx.beginPath(); ctx.arc(0,0,GIFT_R+3,0,Math.PI*2); ctx.stroke(); ctx.restore()
    ctx.fillStyle=`rgba(${gc[0]},${gc[1]},${gc[2]},.18)`
    ctx.strokeStyle=cc; ctx.lineWidth=2; ctx.globalAlpha=1; ctx.setLineDash([])
    ctx.beginPath(); ctx.roundRect(-GIFT_R,-GIFT_R,GIFT_R*2,GIFT_R*2,5); ctx.fill(); ctx.stroke()
    ctx.fillStyle="#fff"; ctx.font="bold 13px Arial"
    ctx.textAlign="center"; ctx.textBaseline="middle"
    ctx.fillText(label,0,1)
    ctx.fillStyle=subcolor; ctx.font="bold 8px Arial"
    ctx.fillText(sublabel,0,GIFT_R+10)
    ctx.restore()
  })
}

/* ── GIFT TYPE 3 (FAKE BOMB) & TYPE 4 (PURPLE BULLET) ────────────────────── */
const PURPLE_IMG = new Image()
PURPLE_IMG.src = "data:image/png;base64,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"

// Type 3: Fake gift — đếm ngược 3s rồi phát nổ xe tăng nhặt phải
// Type 4: Purple bullet — đạn to dần, tracking xe tăng địch gần nhất

let purpleBullets  = []   // {x,y,vx,vy,ownerId,radius,targetId,done}
let purpleFX       = []   // {x,y,side,timer} — hiệu ứng ảnh nhân vật
let fakeBombTimers = {}   // pid → {timer, countdown}

function firePurpleBullet(shooter) {
  // Tìm target gần nhất (khác mình)
  let closest = null, closestDist = Infinity
  for (const pid in players) {
    if (pid === shooter.id) continue
    const t = players[pid]; if (t.alive===false) continue
    const d = Math.hypot(t.x-shooter.x, t.y-shooter.y)
    if (d < closestDist) { closestDist=d; closest=t }
  }
  if (!closest) return

  // Góc hướng target
  const angle = Math.atan2(closest.y-shooter.y, closest.x-shooter.x)
  const speed = 1.2
  const startLen = CFG.TANK.SIZE * 1.2
  purpleBullets.push({
    x: shooter.x + Math.cos(angle)*startLen,
    y: shooter.y + Math.sin(angle)*startLen,
    vx: Math.cos(angle)*speed,
    vy: Math.sin(angle)*speed,
    ownerId: shooter.id,
    targetId: closest.id,
    radius: 6,
    done: false
  })

  // Hiệu ứng ảnh — bên nào shooter đang đứng gần hơn
  const mapW = CFG.MAP.COLS * CFG.MAP.CELL
  const side = shooter.x < mapW/2 ? "left" : "right"
  purpleFX.push({x:shooter.x, y:shooter.y, side, timer:60})  // 60 frames ≈ 1s

  clearPower(shooter)

  if (mode==="multi" && socket && myRoom) {
    socket.emit("purple_bullet_fire", {
      room: myRoom,
      ox: shooter.x, oy: shooter.y,
      tx: closest.x, ty: closest.y,
      targetId: closest.id,
      ownerId: shooter.id,
      side
    })
  }
}

function updatePurpleBullets() {
  purpleBullets = purpleBullets.filter(b => {
    if (b.done) return false
    // To dần
    b.radius = Math.min(b.radius + 0.07, 28)
    // Di chuyển
    b.x += b.vx; b.y += b.vy
    // Out of map?
    if (b.x<0||b.x>CFG.MAP.COLS*CFG.MAP.CELL||b.y<0||b.y>CFG.MAP.ROWS*CFG.MAP.CELL) return false

    // Va chạm với xe tăng địch (chỉ ownerId xử lý)
    if (mode==="single" || b.ownerId===myId) {
      for (const pid in players) {
        if (pid===b.ownerId) continue
        const t=players[pid]; if (t.alive===false) continue
        if (Math.hypot(b.x-t.x,b.y-t.y) < b.radius+CFG.TANK.SIZE/2) {
          // Diệt target
          t.hp=0; t.alive=false
          spawnExplosion(t.x,t.y,t.color||"#888")
          if (players[b.ownerId]) players[b.ownerId].score=(players[b.ownerId].score||0)+1
          if (mode==="multi"&&socket&&myRoom) {
            const newScore=(players[b.ownerId]||{}).score||0
            socket.emit("bullet_hit",{room:myRoom,targetId:pid,shooterId:b.ownerId,
              hp:0,killed:true,shooterScore:newScore})
            socket.emit("notify_death",{room:myRoom,targetId:pid,shooterId:b.ownerId})
            checkScoreWin()
          } else {
            const dead=t
            setTimeout(()=>{const sp=getSpawn();dead.x=sp.x;dead.y=sp.y;dead.hp=100;dead.alive=true},2000)
          }
          b.done=true
          // Explosion particles
          for(let i=0;i<20;i++){
            const a=Math.random()*Math.PI*2,s=1.5+Math.random()*3
            particles.push({type:"spark",x:b.x,y:b.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
              life:1,decay:.025,color:["#c000ff","#7b2ff7","#00aaff","#fff"][Math.floor(Math.random()*4)]})
          }
          return false
        }
      }
    }
    return true
  })
  // Update FX timer
  purpleFX = purpleFX.filter(fx => { fx.timer--; return fx.timer>0 })
}

function updateFakeBombs() {
  for (const pid in fakeBombTimers) {
    const fb = fakeBombTimers[pid]
    fb.timer--
    fb.countdown = Math.ceil(fb.timer / 60)
    if (fb.timer <= 0) {
      // Phát nổ
      const p = players[pid]
      if (p) {
        p.hp=0; p.alive=false
        spawnExplosion(p.x,p.y,p.color||"#888")
        if (mode==="multi"&&socket&&myRoom&&pid===myId) {
          scheduleRespawn()
          socket.emit("notify_death",{room:myRoom,targetId:pid,shooterId:"trap"})
        } else if (mode==="single") {
          const dead=p
          setTimeout(()=>{const sp=getSpawn();dead.x=sp.x;dead.y=sp.y;dead.hp=100;dead.alive=true},2000)
        }
        // Reset power
        p.power=0; p.powerTimer=0
      }
      delete fakeBombTimers[pid]
    }
  }
}

function drawPurpleBullets() {
  purpleBullets.forEach(b => {
    const r = b.radius
    ctx.save()
    // Outer glow
    const grd = ctx.createRadialGradient(b.x,b.y,r*.2,b.x,b.y,r*2.2)
    grd.addColorStop(0,"rgba(150,0,255,0.5)")
    grd.addColorStop(0.5,"rgba(0,100,255,0.25)")
    grd.addColorStop(1,"rgba(0,0,0,0)")
    ctx.fillStyle=grd
    ctx.beginPath(); ctx.arc(b.x,b.y,r*2.2,0,Math.PI*2); ctx.fill()
    // Inner core — purple
    const core = ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,r)
    core.addColorStop(0,"#ffffff")
    core.addColorStop(0.25,"#dd00ff")
    core.addColorStop(0.7,"#7700cc")
    core.addColorStop(1,"rgba(80,0,180,0.6)")
    ctx.fillStyle=core
    ctx.beginPath(); ctx.arc(b.x,b.y,r,0,Math.PI*2); ctx.fill()
    // Blue-purple border
    ctx.strokeStyle="#5588ff"
    ctx.lineWidth=2.5
    ctx.shadowColor="#aa44ff"; ctx.shadowBlur=12
    ctx.beginPath(); ctx.arc(b.x,b.y,r,0,Math.PI*2); ctx.stroke()
    // Extra outer ring
    ctx.strokeStyle="rgba(100,160,255,0.45)"
    ctx.lineWidth=1.5; ctx.shadowBlur=0
    ctx.beginPath(); ctx.arc(b.x,b.y,r*1.5,0,Math.PI*2); ctx.stroke()
    ctx.restore()
  })
}

function drawPurpleFX() {
  purpleFX.forEach(fx => {
    const alpha = Math.min(1, fx.timer/20)
    const W=CFG.MAP.COLS*CFG.MAP.CELL, H=CFG.MAP.ROWS*CFG.MAP.CELL
    const imgW=340, imgH=191
    // Clamp vào trong map
    const isRight = fx.side==="right"
    const drawX = isRight ? Math.min(W-imgW, W*0.52) : Math.max(0, W*0.04)
    const drawY = Math.max(0, Math.min(H-imgH, H/2-imgH/2))

    ctx.save()
    // Clip vào canvas map
    ctx.beginPath(); ctx.rect(0,0,W,H); ctx.clip()
    ctx.globalAlpha = alpha
    if (!isRight) {
      // Lật ngang nếu bên trái
      ctx.translate(drawX+imgW, drawY)
      ctx.scale(-1,1)
      ctx.drawImage(PURPLE_IMG, 0, 0, imgW, imgH)
    } else {
      ctx.drawImage(PURPLE_IMG, drawX, drawY, imgW, imgH)
    }
    ctx.restore()
  })
}

/* ── SEEDED RNG ──────────────────────────────────────────────────────────── */
function mulberry32(seed) {
  return () => {
    seed|=0; seed=seed+0x6D2B79F5|0
    let t=Math.imul(seed^seed>>>15,1|seed)
    t=t+Math.imul(t^t>>>7,61|t)^t
    return ((t^t>>>14)>>>0)/4294967296
  }
}

/* ── INPUT ───────────────────────────────────────────────────────────────── */
window.addEventListener("keydown", e => { keys[e.key]=true;  if(e.key===" ")e.preventDefault() })
window.addEventListener("keyup",   e => { keys[e.key]=false })
window.addEventListener("blur",    () => { for(const k in keys) keys[k]=false })

/* ── FULLSCREEN + CANVAS SCALE ───────────────────────────────────────────── */
let isFsMode = false
function scaleCanvas() {
  if (!isFsMode) { canvas.style.transform=""; canvas.style.transformOrigin=""; return }
  const scaleX = (window.innerWidth  - 24) / canvas.width
  const scaleY = (window.innerHeight - 80) / canvas.height
  const scale  = Math.min(scaleX, scaleY, 2)
  canvas.style.transformOrigin = "top center"
  canvas.style.transform = `scale(${scale})`
}
document.getElementById("btnFullscreen").onclick = () => {
  const gameUi = document.getElementById("game-ui")
  isFsMode = !isFsMode
  gameUi.classList.toggle("fs-mode", isFsMode)
  document.getElementById("btnFullscreen").textContent = isFsMode ? "✕ Thu nhỏ" : "⛶ Toàn màn hình"
  setTimeout(scaleCanvas, 50)
}
window.addEventListener("resize", scaleCanvas)


/* ── MODE TABS ───────────────────────────────────────────────────────────── */
btnSingle.onclick = () => {
  mode="single"; btnSingle.classList.add("active"); btnMulti.classList.remove("active")
  multiPanel.classList.remove("visible"); btnStart.style.display="block"
}
btnMulti.onclick = () => {
  mode="multi"; btnMulti.classList.add("active"); btnSingle.classList.remove("active")
  multiPanel.classList.add("visible"); btnStart.style.display="none"
}
btnBack.onclick = () => location.reload()

/* ── MAZE ────────────────────────────────────────────────────────────────── */
function generateMaze(W, H, rng, complexity=100) {
  const rand = rng||Math.random, m = []
  for (let y=0; y<H; y++) {
    const row = []
    for (let x=0; x<W; x++) row.push({x,y,walls:{top:true,right:true,bottom:true,left:true}})
    m.push(row)
  }
  // Recursive backtracker — tạo mê cung hoàn chỉnh
  const stack=[[0,0]], vis=new Set(["0,0"])
  while (stack.length) {
    const [cx,cy]=stack[stack.length-1], nb=[]
    if(cy>0   &&!vis.has(`${cx},${cy-1}`)) nb.push([cx,cy-1,"top","bottom"])
    if(cx<W-1 &&!vis.has(`${cx+1},${cy}`)) nb.push([cx+1,cy,"right","left"])
    if(cy<H-1 &&!vis.has(`${cx},${cy+1}`)) nb.push([cx,cy+1,"bottom","top"])
    if(cx>0   &&!vis.has(`${cx-1},${cy}`)) nb.push([cx-1,cy,"left","right"])
    if (nb.length) {
      const [nx,ny,cw,nw]=nb[Math.floor(rand()*nb.length)]
      m[cy][cx].walls[cw]=false; m[ny][nx].walls[nw]=false
      vis.add(`${nx},${ny}`); stack.push([nx,ny])
    } else stack.pop()
  }
  // Phá thêm tường theo complexity (0=phá nhiều nhất, 100=giữ nguyên)
  // complexity 100 → 0% tường phá thêm; 0 → ~50% tường nội bộ bị phá
  const extraBreak = (100 - complexity) / 100   // 0.0 → 0.5
  const DIRS = [["top","bottom",-1,0],["right","left",1,0],["bottom","top",0,1],["left","right",-1,0]]
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    for (const [cw,nw,dx,dy] of DIRS) {
      if (!m[y][x].walls[cw]) continue          // đã thông rồi
      const nx=x+dx, ny=y+dy
      if (nx<0||nx>=W||ny<0||ny>=H) continue    // biên ngoài
      if (rand() < extraBreak * 0.6) {           // xác suất phá tường
        m[y][x].walls[cw]=false; m[ny][nx].walls[nw]=false
      }
    }
  }
  return m
}

/* ── WALL HELPERS ────────────────────────────────────────────────────────── */
// Kiểm tra circle có va chạm tường không.
// Duyệt mọi ô mà bounding box của circle chạm vào,
// với mỗi ô check 4 tường theo đúng chiều absolute.
function circleHitsWall(px, py, r) {
  const C = CFG.MAP.CELL
  const x0 = Math.floor((px - r) / C), x1 = Math.floor((px + r) / C)
  const y0 = Math.floor((py - r) / C), y1 = Math.floor((py + r) / C)
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cx >= CFG.MAP.COLS || cy < 0 || cy >= CFG.MAP.ROWS) return true
      const w = maze[cy][cx].walls
      const L=cx*C, T=cy*C, R=L+C, B=T+C
      // Với mỗi tường, kiểm tra circle có chạm vào không
      // Tường top của ô (cy,cx) = đường ngang tại y=T, x in [L,R]
      if (w.top    && py - r < T && px + r > L && px - r < R) return true
      if (w.bottom && py + r > B && px + r > L && px - r < R) return true
      if (w.left   && px - r < L && py + r > T && py - r < B) return true
      if (w.right  && px + r > R && py + r > T && py - r < B) return true
    }
  }
  return false
}
function checkWall(x, y) { return circleHitsWall(x,y,CFG.TANK.SIZE/2) }

function segHitsWall(x1,y1,x2,y2,r) {
  for (let i=0;i<=16;i++) {
    const t=i/16
    if (circleHitsWall(x1+(x2-x1)*t, y1+(y2-y1)*t, r)) return true
  }
  return false
}
function barrelClear(px,py,ang) {
  const len=CFG.TANK.SIZE*1.35+8
  return !segHitsWall(
    px+Math.cos(ang)*CFG.TANK.SIZE*.4, py+Math.sin(ang)*CFG.TANK.SIZE*.4,
    px+Math.cos(ang)*len, py+Math.sin(ang)*len, CFG.BULLET.RADIUS+1)
}

/* ── SLOT CONFIG (4 người) ───────────────────────────────────────────────── */
const SLOT_COLORS = ["#3b82f6","#ef4444","#22c55e","#f59e0b"]
const SLOT_TURRET = ["#1d4ed8","#b91c1c","#15803d","#b45309"]
// Góc bản đồ theo slot: TL, BR, TR, BL
function getSlotSpawn(slot) {
  const C=CFG.MAP.CELL, COLS=CFG.MAP.COLS, ROWS=CFG.MAP.ROWS
  const corners = [
    [[1,1],[2,1],[1,2],[2,2]],
    [[COLS-2,ROWS-2],[COLS-3,ROWS-2],[COLS-2,ROWS-3],[COLS-3,ROWS-3]],
    [[COLS-2,1],[COLS-3,1],[COLS-2,2],[COLS-3,2]],
    [[1,ROWS-2],[2,ROWS-2],[1,ROWS-3],[2,ROWS-3]]
  ]
  const cands = corners[slot] || corners[0]
  let best=null, bestScore=-1
  for (const [cx,cy] of cands) {
    if (cx<0||cx>=COLS||cy<0||cy>=ROWS) continue
    if (!maze[cy]||!maze[cy][cx]) continue
    const w=maze[cy][cx].walls
    const open=(w.top?0:1)+(w.right?0:1)+(w.bottom?0:1)+(w.left?0:1)
    if (open>bestScore) { bestScore=open; best={cx,cy} }
  }
  const fallbacks = [
    {x:C+C/2,y:C+C/2},
    {x:(COLS-2)*C+C/2,y:(ROWS-2)*C+C/2},
    {x:(COLS-2)*C+C/2,y:C+C/2},
    {x:C+C/2,y:(ROWS-2)*C+C/2}
  ]
  if (!best) return fallbacks[slot]||fallbacks[0]
  return {x:best.cx*C+C/2, y:best.cy*C+C/2}
}

/* ── SPAWN helpers ───────────────────────────────────────────────────────── */
function getSpawn(rng) {
  const C=CFG.MAP.CELL, rand=rng||Math.random
  return {x:Math.floor(rand()*CFG.MAP.COLS)*C+C/2, y:Math.floor(rand()*CFG.MAP.ROWS)*C+C/2}
}
function getSpawnFar(other) {
  let sp; do { sp=getSpawn() } while (Math.hypot(sp.x-other.x,sp.y-other.y)<250)
  return sp
}

/* ── LASER SIGHT ─────────────────────────────────────────────────────────── */
function drawLaserSight(p) {
  if (p.power!==1) return
  const C=CFG.MAP.CELL, W=CFG.BULLET.RADIUS+1
  let x=p.x+Math.cos(p.angle)*(CFG.TANK.SIZE*.85+8)
  let y=p.y+Math.sin(p.angle)*(CFG.TANK.SIZE*.85+8)
  let vx=Math.cos(p.angle), vy=Math.sin(p.angle), bounces=0
  ctx.save(); ctx.strokeStyle="rgba(255,80,80,.55)"; ctx.lineWidth=1.5
  ctx.setLineDash([6,5]); ctx.shadowColor="#ff3030"; ctx.shadowBlur=6
  for (let i=0; i<400; i++) {
    const nx=x+vx, ny=y+vy
    const cx2=Math.floor(nx/C), cy2=Math.floor(ny/C)
    if (cx2<0||cx2>=CFG.MAP.COLS||cy2<0||cy2>=CFG.MAP.ROWS) break
    const cell=maze[cy2][cx2]
    const left2=cx2*C, top2=cy2*C, right2=left2+C, bottom2=top2+C
    if (cell.walls.top    && ny-W < top2)    { vy= Math.abs(vy); bounces++ }
    if (cell.walls.bottom && ny+W > bottom2) { vy=-Math.abs(vy); bounces++ }
    if (cell.walls.left   && nx-W < left2)   { vx= Math.abs(vx); bounces++ }
    if (cell.walls.right  && nx+W > right2)  { vx=-Math.abs(vx); bounces++ }
    if (bounces>CFG.BULLET.BOUNCES) break
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+vx,y+vy); ctx.stroke()
    x+=vx; y+=vy
  }
  ctx.restore()
}

/* ── LASER BEAM ──────────────────────────────────────────────────────────── */
let laserBeams = []

// Tính góc lệch giữa hướng nòng và hướng target (0=thẳng, PI=ngược)
function _laserAimOff(shooter, target) {
  const toTarget = Math.atan2(target.y-shooter.y, target.x-shooter.x)
  let diff = Math.abs(shooter.angle - toTarget)
  while (diff > Math.PI) diff = Math.abs(diff - Math.PI*2)
  return diff  // 0..PI
}

// Tạo path gồm nhiều điểm: đi ra viền → chạy theo viền → gấp khúc vào target
function buildLaserPath(shooter, target) {
  const W = CFG.MAP.COLS * CFG.MAP.CELL
  const H = CFG.MAP.ROWS * CFG.MAP.CELL
  const aimOff = _laserAimOff(shooter, target)
  const sx=shooter.x, sy=shooter.y, tx=target.x, ty=target.y

  // Nếu nòng gần thẳng vào target (< 35°): đường cong đẹp biên độ cao
  if (aimOff < Math.PI * 0.2) {
    const dx=tx-sx, dy=ty-sy
    const len=Math.hypot(dx,dy)
    const perp={x:-dy/len,y:dx/len}
    // Biên độ lớn hơn trước, ngẫu nhiên chiều
    const amp = len * (0.7 + Math.random()*0.5) * (Math.random()<.5?1:-1)
    return {
      pts:[
        {x:sx,y:sy},
        {x:sx+dx*.25+perp.x*amp*.7, y:sy+dy*.25+perp.y*amp*.7},
        {x:sx+dx*.75+perp.x*amp*.5, y:sy+dy*.75+perp.y*amp*.5},
        {x:tx,y:ty}
      ],
      curved: true
    }
  }

  // Nòng KHÔNG hướng vào target → vòng viền map trước
  // Bước 1: bay ra viền theo hướng nòng
  const ang = shooter.angle
  const vx = Math.cos(ang), vy = Math.sin(ang)
  // Tính điểm chạm viền
  let tMin = Infinity
  if (vx > 0) tMin = Math.min(tMin, (W - sx) / vx)
  else if (vx < 0) tMin = Math.min(tMin, -sx / vx)
  if (vy > 0) tMin = Math.min(tMin, (H - sy) / vy)
  else if (vy < 0) tMin = Math.min(tMin, -sy / vy)
  tMin *= 0.92  // dừng trước viền một chút
  const edgePt = {x: sx + vx*tMin, y: sy + vy*tMin}

  // Bước 2: từ điểm viền, chạy theo viền map về phía target
  // Chọn 1-2 điểm góc viền để tạo hành trình ôm viền
  const margin = W * 0.08
  function clampEdge(p) {
    return {
      x: Math.max(margin, Math.min(W-margin, p.x)),
      y: Math.max(margin, Math.min(H-margin, p.y))
    }
  }

  // Corner gần target nhất trên cùng cạnh viền với edgePt
  const onLeft   = edgePt.x < margin*2
  const onRight  = edgePt.x > W-margin*2
  const onTop    = edgePt.y < margin*2
  const onBottom = edgePt.y > H-margin*2

  // Tạo waypoint trên viền gần target
  let via1, via2
  const pad = margin * 1.2
  if (onLeft || onRight) {
    const ex = onLeft ? pad : W-pad
    via1 = {x: ex, y: clampEdge({x:0, y: (edgePt.y + ty) * .5}).y}
    via2 = {x: ex * .6 + tx * .4, y: ty * .8 + via1.y * .2}
  } else {
    const ey = onTop ? pad : H-pad
    via1 = {x: clampEdge({x: (edgePt.x + tx) * .5, y:0}).x, y: ey}
    via2 = {x: tx * .8 + via1.x * .2, y: ey * .6 + ty * .4}
  }

  return {
    pts: [
      {x:sx,y:sy},
      edgePt,
      via1,
      via2,
      {x:tx,y:ty}
    ],
    curved: true
  }
}

function fireLaser(shooter) {
  const tid = mode==="single"
    ? (shooter.id==="player"?"bot":"player")
    : Object.keys(players).find(id=>id!==shooter.id)
  const target = players[tid]
  if (!target||target.alive===false) return

  const path = buildLaserPath(shooter, target)
  laserBeams.push({
    pts: path.pts,
    progress: 0
  })

  target.hp=0; target.alive=false
  spawnExplosion(target.x,target.y,target.color||"#888")
  if (players[shooter.id]) players[shooter.id].score=(players[shooter.id].score||0)+1
  if (tid==="bot") BOT.state="PATROL"
  if (mode==="multi"&&socket&&myRoom) {
    socket.emit("laser_fire",{room:myRoom,
      ox:shooter.x, oy:shooter.y,
      tx:target.x,  ty:target.y,
      pts: path.pts,
      shooterId:shooter.id, targetId:tid,
      shooterScore:(players[shooter.id]||{}).score||0})
    socket.emit("notify_death",{room:myRoom,targetId:tid,shooterId:shooter.id})
    checkScoreWin()
  } else {
    const dead=target
    setTimeout(()=>{const sp=getSpawn();dead.x=sp.x;dead.y=sp.y;dead.hp=100;dead.alive=true},2500)
  }
  clearPower(shooter)
}

function updateLasers() {
  laserBeams=laserBeams.filter(lb=>{ lb.progress+=.038; return lb.progress<=1.5 })
}

// Lấy điểm trên path đa đoạn tại tham số t [0,1]
function pathPoint(pts, t) {
  if (pts.length < 2) return pts[0]
  const n = pts.length - 1
  const seg = Math.min(Math.floor(t * n), n-1)
  const lt = t * n - seg
  const a = pts[seg], b = pts[seg+1]
  // Bezier quadratic với control point ở giữa bị kéo ra ngoài
  if (seg < n-1) {
    const c = pts[seg+1]  // midpoint as control
    const mx = (a.x+c.x)*.5, my = (a.y+c.y)*.5
    const cp = {x: a.x+(c.x-a.x)*lt + (b.x-mx)*lt*(1-lt)*1.2,
                y: a.y+(c.y-a.y)*lt + (b.y-my)*lt*(1-lt)*1.2}
    return cp
  }
  return {x:a.x+(b.x-a.x)*lt, y:a.y+(b.y-a.y)*lt}
}

function drawLasers() {
  laserBeams.forEach(lb => {
    const tEnd = Math.min(lb.progress, 1)
    const pts = lb.pts
    const steps = 60
    ctx.save()
    for (const [col,lw,blur] of [
      ["rgba(220,0,255,.2)", 14, 24],
      ["rgba(200,40,255,.65)", 5, 14],
      ["rgba(255,200,255,.95)", 1.8, 4]
    ]) {
      ctx.strokeStyle=col; ctx.lineWidth=lw
      ctx.shadowColor="#cc00ff"; ctx.shadowBlur=blur
      ctx.beginPath()
      for (let i=0; i<=steps; i++) {
        const t = (i/steps) * tEnd
        // Catmull-Rom style smooth through waypoints
        const n = pts.length - 1
        const ft = t * n
        const seg = Math.min(Math.floor(ft), n-1)
        const lt = ft - seg
        const p0 = pts[Math.max(0,seg-1)]
        const p1 = pts[seg]
        const p2 = pts[Math.min(n,seg+1)]
        const p3 = pts[Math.min(n,seg+2)]
        // Catmull-Rom
        const x = .5*((2*p1.x)+(-p0.x+p2.x)*lt+(2*p0.x-5*p1.x+4*p2.x-p3.x)*lt*lt+(-p0.x+3*p1.x-3*p2.x+p3.x)*lt*lt*lt)
        const y = .5*((2*p1.y)+(-p0.y+p2.y)*lt+(2*p0.y-5*p1.y+4*p2.y-p3.y)*lt*lt+(-p0.y+3*p1.y-3*p2.y+p3.y)*lt*lt*lt)
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y)
      }
      ctx.stroke()
    }
    // Đầu đạn sáng chạy theo path
    if (lb.progress < 1) {
      const hp = pathPoint(pts, tEnd)
      const gr2 = ctx.createRadialGradient(hp.x,hp.y,0,hp.x,hp.y,10)
      gr2.addColorStop(0,"rgba(255,255,255,1)")
      gr2.addColorStop(.4,"rgba(220,100,255,.9)")
      gr2.addColorStop(1,"rgba(180,0,255,0)")
      ctx.fillStyle=gr2; ctx.beginPath()
      ctx.arc(hp.x,hp.y,10,0,Math.PI*2); ctx.fill()
    }
    ctx.restore()
  })
}

/* ── BOT AI ──────────────────────────────────────────────────────────────── */
const BOT = {
  state:"PATROL", patrolAngle:Math.random()*Math.PI*2, patrolTimer:0,
  aimTimer:0, lastShot:0, strafeDir:1, strafeTimer:0, stuckTimer:0, lastPos:{x:0,y:0}
}
function hasLOS(ax,ay,bx,by) {
  for (let i=1;i<32;i++) if (circleHitsWall(ax+(bx-ax)*i/32,ay+(by-ay)*i/32,5)) return false
  return true
}
function angDiff(a,b){ let d=a-b; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return d }

function updateBot() {
  if (mode!=="single") return
  const bot=players["bot"], pl=players[myId]
  if (!bot||!pl||bot.alive===false) return
  const C=CFG.MAP.CELL, spd=CFG.TANK.SPEED, now=Date.now()
  const dx=pl.x-bot.x, dy=pl.y-bot.y
  const dist=Math.hypot(dx,dy), atp=Math.atan2(dy,dx)
  const los=hasLOS(bot.x,bot.y,pl.x,pl.y)
  const moved=Math.hypot(bot.x-BOT.lastPos.x,bot.y-BOT.lastPos.y)
  if (moved<.4) BOT.stuckTimer++; else BOT.stuckTimer=0
  BOT.lastPos={x:bot.x,y:bot.y}
  if (BOT.stuckTimer>50){ BOT.patrolAngle+=Math.PI*(.5+Math.random()); BOT.stuckTimer=0 }

  if ((bot.hp||100)<35) BOT.state="EVADE"
  else if (los&&dist<C*5) BOT.state=dist<C*2?"AIM":"CHASE"
  else { BOT.patrolTimer--; if(BOT.patrolTimer<=0)BOT.state="PATROL" }

  if (BOT.state==="PATROL") {
    BOT.patrolTimer=60+Math.floor(Math.random()*80)
    bot.angle+=angDiff(BOT.patrolAngle,bot.angle)*.06
    const vx=Math.cos(bot.angle)*spd*.65, vy=Math.sin(bot.angle)*spd*.65
    if (!checkWall(bot.x+vx,bot.y+vy)) { bot.x+=vx; bot.y+=vy }
    else BOT.patrolAngle=Math.random()*Math.PI*2
    if (Math.random()<.008) BOT.patrolAngle=Math.random()*Math.PI*2
  } else if (BOT.state==="CHASE") {
    const d=angDiff(atp,bot.angle); bot.angle+=d*.08
    BOT.strafeTimer--; if(BOT.strafeTimer<=0){BOT.strafeDir*=-1;BOT.strafeTimer=40+Math.floor(Math.random()*50)}
    const sa=bot.angle+Math.PI/2*BOT.strafeDir
    const fvx=Math.cos(bot.angle)*spd*.85, fvy=Math.sin(bot.angle)*spd*.85
    const svx=Math.cos(sa)*spd*.3,         svy=Math.sin(sa)*spd*.3
    if (!checkWall(bot.x+fvx+svx,bot.y+fvy+svy)) { bot.x+=fvx+svx; bot.y+=fvy+svy }
    else if (!checkWall(bot.x+fvx,bot.y+fvy)) { bot.x+=fvx; bot.y+=fvy }
    else BOT.patrolAngle=bot.angle+Math.PI*(.3+Math.random()*.5)
    if (Math.abs(d)<.2&&los&&now-BOT.lastShot>CFG.BULLET.COOLDOWN+150) { BOT.lastShot=now; spawnBullet(bot,bot.angle) }
  } else if (BOT.state==="AIM") {
    const jitter=(Math.random()-.5)*.035
    const d=angDiff(atp+jitter,bot.angle); bot.angle+=d*.14; BOT.aimTimer++
    if (Math.abs(d)<.1&&BOT.aimTimer>12&&now-BOT.lastShot>CFG.BULLET.COOLDOWN+80) {
      BOT.lastShot=now; BOT.aimTimer=0; spawnBullet(bot,bot.angle)
    }
    BOT.strafeTimer--; if(BOT.strafeTimer<=0){BOT.strafeDir*=-1;BOT.strafeTimer=25+Math.floor(Math.random()*35)}
    const svx=Math.cos(bot.angle+Math.PI/2)*spd*BOT.strafeDir*.45
    const svy=Math.sin(bot.angle+Math.PI/2)*spd*BOT.strafeDir*.45
    if (!checkWall(bot.x+svx,bot.y+svy)) { bot.x+=svx; bot.y+=svy }
  } else if (BOT.state==="EVADE") {
    const d=angDiff(atp+Math.PI,bot.angle); bot.angle+=d*.09
    const vx=Math.cos(bot.angle)*spd, vy=Math.sin(bot.angle)*spd
    if (!checkWall(bot.x+vx,bot.y+vy)) { bot.x+=vx; bot.y+=vy }
    else { BOT.patrolAngle=Math.random()*Math.PI*2; BOT.state="PATROL" }
    if (now-BOT.lastShot>CFG.BULLET.COOLDOWN*1.8) { BOT.lastShot=now; spawnBullet(bot,bot.angle) }
    if ((bot.hp||100)>=60) BOT.state="CHASE"
  }
}

/* ── BULLETS ─────────────────────────────────────────────────────────────── */
function spawnBullet(shooter, angle) {
  if (!barrelClear(shooter.x,shooter.y,angle)) return
  const len=CFG.TANK.SIZE*.85+8
  const bx=shooter.x+Math.cos(angle)*len
  const by=shooter.y+Math.sin(angle)*len
  const vx=Math.cos(angle)*CFG.BULLET.SPEED
  const vy=Math.sin(angle)*CFG.BULLET.SPEED
  bullets.push({x:bx,y:by,vx,vy,bounces:0,ownerId:shooter.id,trail:[]})
  // Multi: emit để người kia cũng thấy đạn
  if (mode==="multi"&&socket&&myRoom&&shooter.id===myId)
    socket.emit("bullet_spawn",{room:myRoom,x:bx,y:by,vx,vy,ownerId:shooter.id})
}

function shoot() {
  const now=Date.now()
  if (now-lastShot<CFG.BULLET.COOLDOWN) return
  const p=players[myId]; if (!p||p.alive===false) return
  if (p.power===2) { fireLaser(p); lastShot=now; return }
  if (p.power===4) { firePurpleBullet(p); lastShot=now; return }
  if (p.power===5) { fireRocket(p); lastShot=now; return }
  lastShot=now
  spawnBullet(p,p.angle)
}

function updateBullets() {
  const C=CFG.MAP.CELL, W=CFG.BULLET.RADIUS+1
  const SUBSTEPS = 5
  bullets = bullets.filter(b => {
    b.trail.push({x:b.x,y:b.y}); if(b.trail.length>6)b.trail.shift()

    for (let step=0; step<SUBSTEPS; step++) {
      b.x += b.vx/SUBSTEPS
      b.y += b.vy/SUBSTEPS

      const cx=Math.floor(b.x/C), cy=Math.floor(b.y/C)
      if (cx<0||cx>=CFG.MAP.COLS||cy<0||cy>=CFG.MAP.ROWS) return false
      const cell=maze[cy][cx]
      const L=cx*C, T=cy*C, R=L+C, Bo=T+C

      // Dùng Math.abs để tránh double-bounce
      if (cell.walls.top    && b.y-W < T  && b.x+W>L && b.x-W<R)  { b.vy= Math.abs(b.vy); b.y=T+W;  b.bounces++ }
      if (cell.walls.bottom && b.y+W > Bo && b.x+W>L && b.x-W<R)  { b.vy=-Math.abs(b.vy); b.y=Bo-W; b.bounces++ }
      if (cell.walls.left   && b.x-W < L  && b.y+W>T && b.y-W<Bo) { b.vx= Math.abs(b.vx); b.x=L+W;  b.bounces++ }
      if (cell.walls.right  && b.x+W > R  && b.y+W>T && b.y-W<Bo) { b.vx=-Math.abs(b.vx); b.x=R-W;  b.bounces++ }

      // Tường ô kề khi đạn tràn biên
      if (b.y-W < T  && cy>0              && maze[cy-1][cx].walls.bottom && b.x+W>L && b.x-W<R)  { b.vy= Math.abs(b.vy); b.y=T+W;  b.bounces++ }
      if (b.y+W > Bo && cy<CFG.MAP.ROWS-1 && maze[cy+1][cx].walls.top    && b.x+W>L && b.x-W<R)  { b.vy=-Math.abs(b.vy); b.y=Bo-W; b.bounces++ }
      if (b.x-W < L  && cx>0              && maze[cy][cx-1].walls.right   && b.y+W>T && b.y-W<Bo) { b.vx= Math.abs(b.vx); b.x=L+W;  b.bounces++ }
      if (b.x+W > R  && cx<CFG.MAP.COLS-1 && maze[cy][cx+1].walls.left   && b.y+W>T && b.y-W<Bo) { b.vx=-Math.abs(b.vx); b.x=R-W;  b.bounces++ }

      if (b.bounces >= CFG.BULLET.BOUNCES) return false
    }

    for (const pid in players) {
      const t=players[pid]
      if (pid===b.ownerId&&b.bounces===0) continue
      if (t.alive===false) continue
      if (Math.hypot(b.x-t.x,b.y-t.y) < CFG.TANK.SIZE/2+CFG.BULLET.RADIUS) {
        if (mode==="single") {
          // Single: xử lý tất cả
          t.hp=Math.max(0,(t.hp||100)-20)
          if (t.hp<=0) {
            t.alive=false; spawnExplosion(t.x,t.y,t.color||"#888")
            if (players[b.ownerId]) players[b.ownerId].score=(players[b.ownerId].score||0)+1
            if (pid==="bot") BOT.state="PATROL"
            const dead=t
            setTimeout(()=>{const sp=getSpawn();dead.x=sp.x;dead.y=sp.y;dead.hp=100;dead.alive=true},2000)
          }
        } else if (mode==="multi" && socket && myRoom) {
          // ── Multi: mỗi client chỉ xử lý 2 trường hợp ──
          if (pid === myId) {
            // CASE 1: Mình bị đạn của người khác trúng → tự tính damage, tự respawn
            // (không cần chờ notify_death từ người bắn — tránh phụ thuộc vào lag)
            t.hp=Math.max(0,(t.hp||100)-20)
            socket.emit("bullet_hit",{room:myRoom,
              targetId:pid, shooterId:b.ownerId,
              hp:t.hp, killed:t.hp<=0})
            if (t.hp<=0) {
              t.alive=false; spawnExplosion(t.x,t.y,t.color||"#888")
              scheduleRespawn()
            }
          } else if (b.ownerId === myId) {
            // CASE 2: Đạn của mình trúng người khác → tính damage, notify server
            t.hp=Math.max(0,(t.hp||100)-20)
            const killed = t.hp<=0
            let newShooterScore = players[b.ownerId].score||0
            if (killed) newShooterScore++
            socket.emit("bullet_hit",{room:myRoom,
              targetId:pid, shooterId:b.ownerId,
              hp:t.hp, killed, shooterScore:newShooterScore})
            if (killed) {
              t.alive=false; spawnExplosion(t.x,t.y,t.color||"#888")
              players[b.ownerId].score = newShooterScore
              socket.emit("notify_death",{room:myRoom,targetId:pid,shooterId:b.ownerId})
              checkScoreWin()
            }
          }
          // CASE 3: Đạn của C trúng D, mình là B (observer) → không xử lý
          // bullet_hit event từ server sẽ sync HP cho observer
        }
        return false
      }
    }
    return b.bounces<CFG.BULLET.BOUNCES
  })
}

/* ── GAME LOOP ───────────────────────────────────────────────────────────── */
let lastEmit=0
let respawnPending=false  // guard chống double-respawn

function scheduleRespawn() {
  if (respawnPending) return   // đã có respawn đang chờ
  respawnPending = true
  const me = players[myId]; if (!me) { respawnPending=false; return }
  me.alive = false
  setTimeout(()=>{
    respawnPending = false
    const _me = players[myId]; if (!_me) return
    const sp = getSlotSpawn(mySlot)
    _me.x = sp.x; _me.y = sp.y; _me.hp = 100; _me.alive = true
    if (socket&&myRoom)
      socket.emit("respawn",{room:myRoom, pid:myId, x:sp.x, y:sp.y})
  }, 2000)
}
function lerpAngle(a,b,t){
  let d=b-a; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return a+d*t
}
function gameLoop() {
  // Input — chỉ điều khiển player của mình
  const p=players[myId]
  if (p&&p.alive!==false) {
    if (keys["a"]||keys["ArrowLeft"])  p.angle-=CFG.TANK.ROT
    if (keys["d"]||keys["ArrowRight"]) p.angle+=CFG.TANK.ROT
    const vx=Math.cos(p.angle)*CFG.TANK.SPEED, vy=Math.sin(p.angle)*CFG.TANK.SPEED
    if (keys["w"]||keys["ArrowUp"])   { if(!checkWall(p.x+vx,p.y+vy)){p.x+=vx;p.y+=vy} }
    if (keys["s"]||keys["ArrowDown"]) { if(!checkWall(p.x-vx,p.y-vy)){p.x-=vx;p.y-=vy} }
    if (keys[" "]) { shoot(); keys[" "]=false }
  }

  // Interpolate vị trí người kia mỗi frame (smooth 60fps từ data 30Hz)
  if (mode==="multi") {
    for (const pid in players) {
      if (pid===myId) continue
      const op=players[pid]
      if (op.tx===undefined) { op.tx=op.x; op.ty=op.y; op.ta=op.angle }
      const dx=op.tx-op.x, dy=op.ty-op.y
      const dist=Math.hypot(dx,dy)
      // Nếu quá xa (teleport/respawn) → snap ngay, không lerp
      if (dist>150) { op.x=op.tx; op.y=op.ty; op.angle=op.ta }
      else {
        op.x     += dx*0.25
        op.y     += dy*0.25
        op.angle  = lerpAngle(op.angle, op.ta, 0.3)
      }
    }
  }

  // Sync vị trí lên server (30Hz) — LUÔN emit kể cả đứng yên / đang chết
  if (mode==="multi"&&socket&&myRoom&&players[myId]) {
    const now=Date.now()
    if (now-lastEmit>33) {
      lastEmit=now
      const _p=players[myId]
      socket.emit("move",{room:myRoom, x:_p.x, y:_p.y, angle:_p.angle, alive:_p.alive})
    }
  }

  updateBullets(); updateBot()
  updateParticles(); updateGifts(); updateLasers()
  updatePurpleBullets(); updateFakeBombs(); updateRockets()
  draw()
  requestAnimationFrame(gameLoop)
}

/* ── INIT & START ────────────────────────────────────────────────────────── */
function getMazeScale(complexity) {
  // complexity 0-40 → giữ nguyên (trống/thoáng)
  // complexity 41-100 → tăng dần COLS/ROWS, giảm CELL/TANK/GIFT
  if (complexity <= 40) {
    return { cols:12, rows:8, cell:90, tankSize:26, giftR:14, giftIV:GIFT_SPAWN_SECONDS*FPS }
  }
  // map 41→100 sang tỉ lệ 0→1
  const t = (complexity - 40) / 60
  const cols    = Math.round(12 + t * 8)   // 12→20
  const rows    = Math.round(8  + t * 6)   // 8→14
  const cell    = Math.round(90 - t * 28)  // 90→62
  const tankSz  = Math.round(26 - t * 8)   // 26→18
  const giftR   = Math.round(14 - t * 4)   // 14→10
  const giftIV  = GIFT_SPAWN_SECONDS * FPS   // dùng hằng số cố định
  return { cols, rows, cell, tankSize:tankSz, giftR, giftIV }
}

function initMaze(seed) {
  const sc = getMazeScale(roomSettings.maze_complexity)
  CFG.MAP.COLS = sc.cols
  CFG.MAP.ROWS = sc.rows
  CFG.MAP.CELL = sc.cell
  CFG.TANK.SIZE = sc.tankSize
  GIFT_R = sc.giftR
  GIFT_IV = sc.giftIV
  canvas.width  = sc.cols * sc.cell
  canvas.height = sc.rows * sc.cell
  setTimeout(scaleCanvas, 0)
  maze = generateMaze(
    sc.cols, sc.rows,
    seed!=null ? mulberry32(seed) : null,
    roomSettings.maze_complexity
  )
}

function resetState() {
  players={}; bullets=[]; particles=[]; gifts=[]; laserBeams=[]; giftTimer=0
  purpleBullets=[]; purpleFX=[]; fakeBombTimers={}; rockets=[]
  gameOver=false; respawnPending=false
  hideGameOverScreen()
}

function startGame() {
  gameUI.classList.remove("hidden")
  menu.style.display="none"
  if (!loopRunning) { loopRunning=true; gameLoop() }
}

function startSingle(name) {
  resetState(); initMaze(null); mode="single"; myId="player"; mySlot=0
  const sp1=getSpawn()
  players[myId]={id:myId,name,x:sp1.x,y:sp1.y,angle:0,
    slot:0,color:SLOT_COLORS[0],hp:100,score:0,alive:true}
  const sp2=getSpawnFar(sp1)
  players["bot"]={id:"bot",name:"Bot",x:sp2.x,y:sp2.y,angle:Math.PI,
    slot:1,color:SLOT_COLORS[1],hp:100,score:0,alive:true}
  BOT.lastPos={x:sp2.x,y:sp2.y}
  startGame()
}

/* ── MULTIPLAYER ─────────────────────────────────────────────────────────── */
// Lưu thông tin pending để dùng khi game_start đến
let pendingName = ""
let pendingMazeSeed = null

function initSocket() {
  if (socket) return
  socket = io()

  socket.on("connect", () => {
    myId = socket.id
    console.log("[SOCKET] connected:", myId)
  })

  /* ── HOST: phòng đã tạo, vào màn chờ ──────────────────────────────────── */
  socket.on("room_created", data => {
    console.log("[room_created]", data)
    myRoom = data.room
    mySlot = data.slot !== undefined ? data.slot : 0
    pendingMazeSeed = data.maze_seed

    // Cập nhật UI — ẩn step1, hiện panel host
    document.getElementById("mpStep1").style.display  = "none"
    document.getElementById("mpHost").style.display   = "block"
    document.getElementById("mpJoiner").style.display = "none"
    document.getElementById("roomCode").textContent   = data.room
    roomDisplay.textContent = "Phòng: " + data.room
    roomDisplay.style.display = "block"
    roomStatus.textContent = ""
    // Hiện mình trong danh sách chờ (slot 0 = host)
    updateWaitingList([{id:myId, name:pendingName, slot:0}])

    // Nút Bắt đầu disabled — chờ P2
    const btnBegin = document.getElementById("btnBegin")
    btnBegin.disabled = true
    btnBegin.style.opacity = ".45"
    btnBegin.style.cursor  = "not-allowed"
    btnBegin.textContent   = "⏳ Chờ người chơi 2..."
  })

  /* ── HOST: P2 vào rồi → kích hoạt nút Bắt đầu ─────────────────────────── */
  socket.on("player_ready", data => {
    console.log("[player_ready]", data)
    updateWaitingList(null, data)  // thêm người mới vào danh sách chờ
    const btnBegin = document.getElementById("btnBegin")
    const count = data.count || 2
    btnBegin.disabled = false
    btnBegin.style.opacity = "1"
    btnBegin.style.cursor  = "pointer"
    btnBegin.textContent   = `🎮 Bắt đầu! (${count}/4 người)`
    roomStatus.textContent = ""
  })

  /* ── P2: đã join phòng thành công, chờ host bắt đầu ───────────────────── */
  socket.on("room_joined", data => {
    console.log("[room_joined]", data)
    myRoom = data.room
    mySlot = data.slot   // server gán slot chính xác
    // Cập nhật tên mặc định đúng theo slot (nếu user không nhập tên)
    if (!inputName.value.trim()) pendingName = `Player${mySlot + 1}`
    pendingMazeSeed = data.maze_seed
    // Joiner nhận settings từ server
    if (data.settings) {
      roomSettings.maze_complexity = data.settings.maze_complexity ?? 100
      roomSettings.game_mode       = data.settings.game_mode       ?? "infinite"
      roomSettings.score_limit     = data.settings.score_limit     ?? 10
    }

    document.getElementById("mpStep1").style.display  = "none"
    document.getElementById("mpHost").style.display   = "none"
    document.getElementById("mpJoiner").style.display = "block"
    roomDisplay.textContent = "Phòng: " + data.room
    roomDisplay.style.display = "block"
    roomStatus.textContent = ""
    // Cập nhật UI phòng chờ: hiển thị mình + những người đã có
    const allPlayers = [...(data.existing_players || []), {id:myId, name:pendingName, slot:mySlot}]
    updateWaitingList(allPlayers)
  })

  /* ── CẢ HAI nhận khi host bấm Bắt đầu → khởi tạo game ────────────────── */
  socket.on("game_start", data => {
    console.log("[game_start]", data, "myId=", myId, "mySlot=", mySlot)
    resetState()
    mode = "multi"

    // Áp dụng settings từ host
    if (data.settings) {
      roomSettings.maze_complexity = data.settings.maze_complexity ?? 100
      roomSettings.game_mode       = data.settings.game_mode       ?? "infinite"
      roomSettings.score_limit     = data.settings.score_limit     ?? 10
    }

    const seed = data.maze_seed !== undefined ? data.maze_seed : pendingMazeSeed
    initMaze(seed)

    // Tạo tất cả players từ danh sách server gửi
    data.players.forEach(pd => {
      const sp = getSlotSpawn(pd.slot)
      // Góc ban đầu hướng vào giữa bản đồ
      const cx = CFG.MAP.COLS*CFG.MAP.CELL/2, cy = CFG.MAP.ROWS*CFG.MAP.CELL/2
      const initAngle = Math.atan2(cy-sp.y, cx-sp.x)
      players[pd.id] = {
        id: pd.id,
        name: pd.id === myId ? (pendingName || pd.name) : pd.name,
        slot: pd.slot,
        x: sp.x, y: sp.y,
        angle: initAngle,
        color: SLOT_COLORS[pd.slot] || "#888",
        hp: 100, score: 0, alive: true
      }
    })

    console.log("[game_start] players created:", Object.keys(players))
    startGame()
    // Hiện chat box khi vào game multiplayer
    if (window.showChatBox) window.showChatBox()
  })

  /* ── Sync vị trí người kia (với interpolation target) ──────────────────── */
  socket.on("peer_move", data => {
    if (data.id === myId) return
    if (!players[data.id]) {
      // Player chưa có (late join edge case) — tạo placeholder
      const slot = data.slot != null ? data.slot : (mySlot === 0 ? 1 : 0)
      const sp = getSlotSpawn(slot)
      players[data.id] = {
        id:data.id, name:"Player", slot,
        x:sp.x, y:sp.y, angle:0,
        tx:sp.x, ty:sp.y, ta:0,
        color:SLOT_COLORS[slot]||"#888", hp:100, score:0, alive:true
      }
    }
    players[data.id].tx = data.x
    players[data.id].ty = data.y
    players[data.id].ta = data.angle
    if (data.alive === true && players[data.id].alive === false) {
      players[data.id].alive = true
      players[data.id].hp = Math.max(players[data.id].hp || 0, 1)
    }
  })

  /* ── Nhận đạn từ người kia ─────────────────────────────────────────────── */
  socket.on("bullet_spawn", data => {
    if (data.ownerId === myId) return
    bullets.push({x:data.x, y:data.y, vx:data.vx, vy:data.vy,
      bounces:0, ownerId:data.ownerId, trail:[]})
  })

  /* ── Nhận kết quả bắn trúng (observer + victim sync) ──────────────────── */
  socket.on("bullet_hit", data => {
    // Nếu mình là shooter → bỏ qua (tự tính rồi ở updateBullets CASE 2)
    if (data.shooterId === myId) return

    // Sync score của shooter cho TẤT CẢ client (kể cả victim) — TRƯỚC khi check win
    if (data.shooterScore != null && players[data.shooterId]) {
      players[data.shooterId].score = data.shooterScore
    }

    // Nếu mình là target → HP/alive đã tự tính ở CASE 1
    if (data.targetId === myId) {
      if (data.killed) checkScoreWin()  // score đã sync ở trên rồi
      return
    }

    // Mình là observer → sync HP + alive của target
    const t = players[data.targetId]; if (!t) return
    t.hp = data.hp
    if (data.killed) {
      t.alive = false
      spawnExplosion(t.x, t.y, t.color||"#888")
      checkScoreWin()
    }
  })

  /* ── Respawn người kia ──────────────────────────────────────────────────── */
  socket.on("peer_respawn", data => {
  if (data.pid === myId) return
  const t = players[data.pid]
  if (!t) return

  t.x = data.x
  t.y = data.y
  t.hp = 100
  t.alive = true
})

  /* ── Nhận gift spawn từ host ───────────────────────────────────────────── */
  socket.on("gift_spawn", data => {
    if (mySlot === 0) return   // host tự spawn rồi
    gifts.push({x:data.x, y:data.y, type:data.gtype, pulse:0})
  })

  /* ── Người kia nhặt gift ───────────────────────────────────────────────── */
  socket.on("gift_pickup", data => {
    if (data.pid === myId) return
    gifts = gifts.filter(g => !(Math.abs(g.x-data.gx)<2 && Math.abs(g.y-data.gy)<2))
    if (players[data.pid]) {
      if (data.gtype===3) {
        // Fake bomb: observer thấy đếm ngược trên đầu người nhặt
        fakeBombTimers[data.pid] = {timer:180, countdown:3}
        spawnPickupFX(data.gx, data.gy, 3)
      } else {
        players[data.pid].power = data.gtype
        players[data.pid].powerTimer = 600
        spawnPickupFX(data.gx, data.gy, data.gtype)
      }
    }
  })

  /* ── Người kia dùng xong gift → clear power ────────────────────────────── */
  socket.on("power_clear", data => {
    if (data.pid === myId) return
    const p = players[data.pid]; if (!p) return
    p.power = 0; p.powerTimer = 0
  })

  /* ── Nhận laser từ người kia ───────────────────────────────────────────── */
  socket.on("laser_fire", data => {
    if (data.shooterId === myId) return
    // Hỗ trợ cả format cũ (cp1/cp2) lẫn format mới (pts)
    let pts
    if (data.pts) {
      pts = data.pts
    } else {
      pts = [
        {x:data.ox, y:data.oy},
        {x:data.cp1x, y:data.cp1y},
        {x:data.cp2x, y:data.cp2y},
        {x:data.tx,  y:data.ty}
      ]
    }
    laserBeams.push({ pts, progress:0 })
    const target = players[data.targetId]
    if (target) {
      target.hp = 0; target.alive = false
      spawnExplosion(target.x, target.y, target.color||"#888")
      if (data.targetId === myId) scheduleRespawn()
    }
    if (players[data.shooterId])
      players[data.shooterId].score = data.shooterScore
    checkScoreWin()
  })

  /* ── Nhận purple bullet từ người khác ──────────────────────────────────── */
  socket.on("purple_bullet_fire", data => {
    if (data.ownerId === myId) return
    const angle = Math.atan2(data.ty-data.oy, data.tx-data.ox)
    const speed = 1.2
    purpleBullets.push({
      x: data.ox + Math.cos(angle)*CFG.TANK.SIZE*1.2,
      y: data.oy + Math.sin(angle)*CFG.TANK.SIZE*1.2,
      vx: Math.cos(angle)*speed,
      vy: Math.sin(angle)*speed,
      ownerId: data.ownerId,
      targetId: data.targetId,
      radius: 6, done: false
    })
    purpleFX.push({x:data.ox, y:data.oy, side:data.side, timer:60})
  })

  /* ── Nhận rocket từ người khác ─────────────────────────────────────────── */
  socket.on("rocket_fire", data => {
    if (data.ownerId === myId) return
    rockets.push({
      x: data.rx, y: data.ry,
      angle: data.angle,
      visualAngle: data.angle,
      wps: data.wps,
      wpIdx: 0,
      rid: data.rid,
      ownerId: data.ownerId,
      targetId: data.targetId,
      trail: [], done: false
    })
  })

  /* ── Cập nhật vị trí rocket từ owner ──────────────────────────────────── */
  socket.on("rocket_pos", data => {
    const rk = rockets.find(r=>r.rid===data.rid && !r.done)
    if (!rk) return
    rk.x=data.x; rk.y=data.y; rk.angle=data.angle
  })

  /* ── Owner báo rocket đã nổ ────────────────────────────────────────────── */
  socket.on("rocket_done", data => {
    const rk = rockets.find(r=>r.rid===data.rid)
    if (rk) {
      // Hiện vụ nổ phía client nhận
      for (let i=0;i<20;i++) {
        const a=Math.random()*Math.PI*2, s=1.5+Math.random()*4
        particles.push({type:"spark",x:rk.x,y:rk.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
          life:1,decay:.025,color:["#ff8800","#ffcc00","#ff3300","#fff"][Math.floor(Math.random()*4)]})
      }
      rk.done=true
    }
  })


  /* ── Fake bomb nổ ở người kia (sync) ────────────────────────────────────── */
  socket.on("fake_bomb_explode", data => {
    const t = players[data.pid]; if (!t) return
    t.hp=0; t.alive=false
    spawnExplosion(t.x, t.y, t.color||"#888")
    if (data.pid === myId) scheduleRespawn()
  })

  /* ── Server báo mình bị chết (do người kia tính) ─────────────────────── */
  socket.on("you_died", data => {
    const me = players[myId]; if (!me) return
    if (!me.alive) return   // đã dead rồi (tránh xử lý 2 lần)
    me.alive = false
    spawnExplosion(me.x, me.y, me.color||"#888")
    scheduleRespawn()
  })

  /* ── Người kia thoát ───────────────────────────────────────────────────── */
  socket.on("peer_left", data => {
    delete players[data.id]
    roomStatus.textContent = "⚠️ Người chơi kia đã thoát"
    roomStatus.style.color = "#f87171"
  })

  socket.on("room_error",    d => { roomStatus.textContent="❌ "+d.msg; roomStatus.style.color="#f87171" })
  socket.on("connect_error", () => { roomStatus.textContent="❌ Không kết nối được"; roomStatus.style.color="#f87171" })

  /* ── Game Over từ host ─────────────────────────────────────────────────── */
  socket.on("game_over", data => {
    if (gameOver) return  // đã hiện rồi
    gameOver = true
    showGameOverScreen(data.rankings || [])
  })

  /* ── Chat ───────────────────────────────────────────────────────────────── */
  socket.on("chat_msg", data => {
    appendChatMsg(data.name, data.text, data.slot)
  })
}

/* ── GAME OVER / WIN ─────────────────────────────────────────────────────── */
function checkScoreWin() {
  if (roomSettings.game_mode !== "score") return
  if (gameOver) return
  const limit = roomSettings.score_limit
  const winner = Object.values(players).find(p => (p.score||0) >= limit)
  if (!winner) return
  gameOver = true
  // Chỉ host emit game_over để tránh duplicate
  if (mySlot === 0 && socket && myRoom) {
    const rankings = Object.values(players)
      .sort((a,b) => (b.score||0) - (a.score||0))
      .map(p => ({id:p.id, name:p.name, score:p.score||0, slot:p.slot}))
    socket.emit("game_over", {room:myRoom, rankings})
  }
  showGameOverScreen(Object.values(players).sort((a,b)=>(b.score||0)-(a.score||0)))
}

function showGameOverScreen(rankings) {
  gameOver = true
  let el = document.getElementById("gameOverScreen")
  if (!el) {
    el = document.createElement("div")
    el.id = "gameOverScreen"
    el.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);
    `
    document.body.appendChild(el)
  }
  const medals = ["🥇","🥈","🥉","🎖"]
  const rows = rankings.map((p,i) => {
    const color = SLOT_COLORS[p.slot||0]
    const isMe = p.id === myId
    return `<div style="
      display:flex;align-items:center;gap:16px;padding:12px 24px;
      background:${isMe?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.03)"};
      border-radius:12px;border:1px solid ${isMe?"rgba(255,255,255,0.15)":"transparent"};
      margin:4px 0;min-width:320px;
    ">
      <span style="font-size:28px;width:36px;text-align:center">${medals[i]||"·"}</span>
      <span style="width:14px;height:14px;border-radius:50%;background:${color};flex-shrink:0"></span>
      <span style="flex:1;font-size:16px;font-weight:700;color:#fff">${escHtml(p.name)}${isMe?" (bạn)":""}</span>
      <span style="font-family:'Orbitron',sans-serif;font-size:20px;color:${color};font-weight:900">${p.score}</span>
      <span style="font-size:12px;color:#666">điểm</span>
    </div>`
  }).join("")

  el.innerHTML = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-family:'Orbitron',sans-serif;font-size:36px;font-weight:900;
        color:#fff;letter-spacing:4px;text-shadow:0 0 32px rgba(79,142,247,0.8)">
        KẾT THÚC
      </div>
      <div style="font-size:14px;color:#7070a0;margin-top:6px">
        ${rankings[0]?.name || "?"} đã đạt ${roomSettings.score_limit} điểm!
      </div>
    </div>
    <img src="data:image/jpeg;base64,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" style="width:150px;height:150px;object-fit:cover;border-radius:50%;border:3px solid rgba(255,255,255,0.2);margin-bottom:16px;box-shadow:0 0 24px rgba(79,142,247,0.5);" alt="pharaoh"/>
    <div style="display:flex;flex-direction:column;gap:2px">${rows}</div>
    <button onclick="location.reload()" style="
      margin-top:28px;padding:14px 40px;
      font-family:'Be Vietnam Pro',sans-serif;font-size:16px;font-weight:700;
      background:linear-gradient(135deg,#3a7bd5,#2563eb);color:#fff;
      border:none;border-radius:12px;cursor:pointer;
      box-shadow:0 4px 20px rgba(37,99,235,0.5);
    ">← Quay về Menu</button>
  `
  el.style.display = "flex"
}

function hideGameOverScreen() {
  const el = document.getElementById("gameOverScreen")
  if (el) el.style.display = "none"
}

/* ── WAITING ROOM LIST ───────────────────────────────────────────────────── */
// waitingPlayers: slot → {name, slot} — chỉ dùng trong phòng chờ
const waitingPlayers = {}

function updateWaitingList(existing, newPlayer) {
  if (existing) {
    Object.keys(waitingPlayers).forEach(k => delete waitingPlayers[k])
    existing.forEach(p => { waitingPlayers[p.slot] = p })
  }
  if (newPlayer && newPlayer.slot != null) {
    waitingPlayers[newPlayer.slot] = newPlayer
  }
  // Render vào cả 2 element (host dùng #waitingList, joiner dùng #waitingListJoiner)
  const targets = [
    document.getElementById("waitingList"),
    document.getElementById("waitingListJoiner")
  ].filter(Boolean)
  targets.forEach(el => {
    el.innerHTML = ""
    for (let s = 0; s < 4; s++) {
      const p = waitingPlayers[s]
      const dot = document.createElement("span")
      dot.style.cssText = "display:inline-flex;align-items:center;gap:5px;font-size:12px;"
      const circle = `<span style="width:10px;height:10px;border-radius:50%;background:${SLOT_COLORS[s]};display:inline-block"></span>`
      dot.innerHTML = circle + (p ? `<b>${escHtml(p.name)}</b>` : `<span style="color:#3a3a60">Chờ...</span>`)
      el.appendChild(dot)
    }
  })
}

/* ── BUTTON HANDLERS ─────────────────────────────────────────────────────── */
btnStart.onclick = () => {
  if (mode === "single") startSingle(inputName.value.trim() || "Player")
}
btnCreate.onclick = () => {
  pendingName = inputName.value.trim() || "Player1"
  initSocket()
  roomStatus.textContent = "⏳ Đang tạo phòng..."; roomStatus.style.color = "#facc15"
  socket.emit("create_room", {name: pendingName})
}
btnJoin.onclick = () => {
  const rid = inputRoom.value.trim().toUpperCase()
  if (!rid) { roomStatus.textContent="❌ Nhập mã phòng"; roomStatus.style.color="#f87171"; return }
  pendingName = inputName.value.trim() || ""  // sẽ set đúng sau khi nhận slot từ room_joined
  initSocket()
  roomStatus.textContent = "⏳ Đang kết nối..."; roomStatus.style.color = "#facc15"
  socket.emit("join_room_req", {name: pendingName, room: rid})
}
document.getElementById("btnBegin").onclick = () => {
  if (!myRoom) return
  // Đọc settings LÚC BẮT ĐẦU (sau khi người dùng đã chỉnh xong)
  const complexity = parseInt(document.getElementById("settingComplexity")?.value ?? 100)
  const gameMode   = document.querySelector('input[name="gameMode"]:checked')?.value ?? "infinite"
  const scoreLimit = parseInt(document.getElementById("settingScoreLimit")?.value ?? 10)
  roomSettings.maze_complexity = complexity
  roomSettings.game_mode       = gameMode
  roomSettings.score_limit     = scoreLimit
  socket.emit("start_game", {
    room: myRoom,
    maze_complexity: complexity,
    game_mode:       gameMode,
    score_limit:     scoreLimit,
  })
}

/* ── DRAW ────────────────────────────────────────────────────────────────── */
function draw() {
  updateHUD()
  const C=CFG.MAP.CELL
  ctx.fillStyle="#ede9e2"; ctx.fillRect(0,0,canvas.width,canvas.height)
  // Cells
  maze.forEach((row,y)=>row.forEach((cell,x)=>{
    ctx.fillStyle=(x+y)%2===0?"#e8e4dd":"#e2ddd6"
    ctx.fillRect(x*C+1,y*C+1,C-2,C-2)
  }))
  // Walls
  ctx.strokeStyle="#2c2c2c"; ctx.lineWidth=4; ctx.lineCap="square"
  maze.forEach((row,y)=>row.forEach((cell,x)=>{
    const px=x*C, py=y*C; ctx.beginPath()
    if(cell.walls.top)   {ctx.moveTo(px,py);   ctx.lineTo(px+C,py)}
    if(cell.walls.right) {ctx.moveTo(px+C,py); ctx.lineTo(px+C,py+C)}
    if(cell.walls.bottom){ctx.moveTo(px,py+C); ctx.lineTo(px+C,py+C)}
    if(cell.walls.left)  {ctx.moveTo(px,py);   ctx.lineTo(px,py+C)}
    ctx.stroke()
  }))
  drawGifts()
  drawPurpleBullets()
  drawRockets()
  Object.values(players).forEach(p=>{ if(p.alive!==false) drawLaserSight(p) })
  // Bullets
  bullets.forEach(b=>{
    b.trail.forEach((pt,i)=>{
      ctx.save(); ctx.globalAlpha=(i+1)/b.trail.length*.35; ctx.fillStyle="#555"
      ctx.beginPath(); ctx.arc(pt.x,pt.y,CFG.BULLET.RADIUS*.55,0,Math.PI*2); ctx.fill(); ctx.restore()
    })
    ctx.save()
    ctx.strokeStyle="rgba(255,255,255,.85)"; ctx.lineWidth=1.5
    ctx.beginPath(); ctx.arc(b.x,b.y,CFG.BULLET.RADIUS+1,0,Math.PI*2); ctx.stroke()
    ctx.fillStyle="#111"
    ctx.beginPath(); ctx.arc(b.x,b.y,CFG.BULLET.RADIUS,0,Math.PI*2); ctx.fill()
    ctx.restore()
  })
  drawLasers()
  drawPurpleFX()
  drawParticles()
  // Tanks + labels
  Object.values(players).forEach(p=>{
    if (p.alive===false) return
    drawTank(p)
    ctx.save()
    ctx.font="bold 11px 'Be Vietnam Pro',sans-serif"; ctx.textAlign="center"
    ctx.fillStyle=p.color; ctx.shadowColor="rgba(0,0,0,.8)"; ctx.shadowBlur=4
    ctx.fillText(p.name,p.x,p.y-CFG.TANK.SIZE/2-9)
    if (p.power) {
      const frac=(p.powerTimer||0)/600
      const pcol = p.power===1?"#00ffcc":p.power===4?"#cc44ff":p.power===5?"#ff8800":"#dd44ff"
      const plbl = p.power===1?"L1":p.power===2?"L2":p.power===5?"🚀":"⚡"
      ctx.font="bold 10px Arial"; ctx.fillStyle=pcol
      ctx.shadowBlur=0; ctx.fillText(plbl,p.x,p.y-CFG.TANK.SIZE/2-22)
      ctx.strokeStyle=pcol; ctx.lineWidth=2
      ctx.beginPath()
      ctx.arc(p.x,p.y-CFG.TANK.SIZE/2-22,8,-Math.PI/2,-Math.PI/2+Math.PI*2*frac)
      ctx.stroke()
    }
    // Fake bomb countdown
    if (fakeBombTimers[p.id]) {
      const cd = fakeBombTimers[p.id].countdown
      ctx.save()
      ctx.font="bold 18px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle"
      ctx.fillStyle="#ff2222"; ctx.shadowColor="#ff0000"; ctx.shadowBlur=12
      ctx.fillText("💣"+cd,p.x,p.y-CFG.TANK.SIZE/2-36)
      ctx.restore()
    }
    ctx.restore()
  })
}

/* ── ROCKET (Gift type 5) ─────────────────────────────────────────────────── */
let rockets = []
// Sync power=0 cho client khác khi dùng xong gift
function clearPower(shooter) {
  shooter.power = 0; shooter.powerTimer = 0
  if (mode==="multi" && socket && myRoom && shooter.id===myId)
    socket.emit("power_clear", {room:myRoom, pid:shooter.id})
}


function mazeBFS(sc, sr, ec, er) {
  const COLS=CFG.MAP.COLS, ROWS=CFG.MAP.ROWS
  if (sc===ec && sr===er) return [{c:sc,r:sr}]
  const key=(c,r)=>c+r*COLS
  const visited=new Set([key(sc,sr)])
  const queue=[{c:sc,r:sr,path:[{c:sc,r:sr}]}]
  const DIRS=[
    {dc:0,dr:-1,wall:"top"},{dc:1,dr:0,wall:"right"},
    {dc:0,dr:1,wall:"bottom"},{dc:-1,dr:0,wall:"left"},
  ]
  while (queue.length) {
    const {c,r,path}=queue.shift()
    for (const d of DIRS) {
      const nc=c+d.dc, nr=r+d.dr
      if (nc<0||nc>=COLS||nr<0||nr>=ROWS) continue
      if (visited.has(key(nc,nr))) continue
      if (maze[r][c].walls[d.wall]) continue
      const np=[...path,{c:nc,r:nr}]
      if (nc===ec && nr===er) return np
      visited.add(key(nc,nr))
      queue.push({c:nc,r:nr,path:np})
    }
  }
  return [{c:sc,r:sr},{c:ec,r:er}]
}

function fireRocket(shooter) {
  // Tìm target gần nhất còn sống
  let closest=null, closestDist=Infinity
  for (const pid in players) {
    if (pid===shooter.id) continue
    const t=players[pid]; if (t.alive===false) continue
    const d=Math.hypot(t.x-shooter.x,t.y-shooter.y)
    if (d<closestDist) { closestDist=d; closest=t }
  }
  if (!closest) return

  const C=CFG.MAP.CELL
  const sc=Math.floor(shooter.x/C), sr=Math.floor(shooter.y/C)
  const ec=Math.floor(closest.x/C), er=Math.floor(closest.y/C)
  const cellPath=mazeBFS(sc,sr,ec,er)

  // Tạo waypoints đi qua MIDPOINT của cửa thông giữa 2 ô liên tiếp
  // Đảm bảo rocket đi qua khe hở tường, không bị kẹt góc
  const wps = []
  for (let i=0; i<cellPath.length-1; i++) {
    const a=cellPath[i], b=cellPath[i+1]
    // Midpoint trên biên chung giữa ô a và ô b
    const mx = (a.c + b.c + 1) * C / 2   // = (a.c*C+C/2 + b.c*C+C/2)/2
    const my = (a.r + b.r + 1) * C / 2
    wps.push({x:mx, y:my})
  }
  // Điểm cuối là vị trí thực của target
  wps.push({x:closest.x, y:closest.y})

  const len=CFG.TANK.SIZE*.85+8
  const rx=shooter.x+Math.cos(shooter.angle)*len
  const ry=shooter.y+Math.sin(shooter.angle)*len

  rockets.push({x:rx, y:ry, angle:shooter.angle,
    visualAngle: shooter.angle,
    wps, wpIdx:0,
    rid: `${shooter.id}_${Date.now()}`,
    ownerId:shooter.id, targetId:closest.id,
    trail:[], done:false})
  clearPower(shooter)

  if (mode==="multi"&&socket&&myRoom)
    socket.emit("rocket_fire",{room:myRoom,
      rx, ry, angle:shooter.angle,
      wps, ownerId:shooter.id, targetId:closest.id,
      rid: rockets[rockets.length-1].rid})
}

function _rocketHit(rk) {
  rk.done=true
  for (let i=0;i<32;i++) {
    const a=Math.random()*Math.PI*2, s=1.5+Math.random()*4.5
    particles.push({type:"spark",x:rk.x,y:rk.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
      life:1,decay:.02,color:["#ff8800","#ffcc00","#ff3300","#fff","#ff6600"][Math.floor(Math.random()*5)]})
  }
  // Chỉ owner xử lý damage
  if (mode==="single"||rk.ownerId===myId) {
    const t=players[rk.targetId]; if (t&&t.alive!==false) {
      t.hp=0; t.alive=false
      spawnExplosion(t.x,t.y,t.color||"#888")
      if (players[rk.ownerId]) players[rk.ownerId].score=(players[rk.ownerId].score||0)+1
      if (mode==="multi"&&socket&&myRoom) {
        socket.emit("bullet_hit",{room:myRoom,targetId:rk.targetId,shooterId:rk.ownerId,
          hp:0,killed:true,shooterScore:(players[rk.ownerId]||{}).score||0})
        socket.emit("notify_death",{room:myRoom,targetId:rk.targetId,shooterId:rk.ownerId})
        checkScoreWin()
      } else {
        const dead=t
        setTimeout(()=>{const sp=getSpawn();dead.x=sp.x;dead.y=sp.y;dead.hp=100;dead.alive=true},2000)
      }
    }
    // Báo cho client khác xóa rocket này
    if (mode==="multi"&&socket&&myRoom)
      socket.emit("rocket_done",{room:myRoom, rid:rk.rid})
  }
}

function updateRockets() {
  const SPEED = 1.8
  const VISUAL_TURN = 0.22   // tốc độ xoay visual angle (rad/frame)

  rockets=rockets.filter(rk=>{
    if (rk.done) return false

    // Trail
    rk.trail.push({x:rk.x, y:rk.y, life:1})
    if (rk.trail.length>24) rk.trail.shift()
    rk.trail.forEach(t=>t.life-=0.042)

    // Tia lửa đuôi
    const ba = rk.visualAngle + Math.PI
    for (let i=0;i<2;i++) {
      const sp=(Math.random()-.5)*.9, s=0.8+Math.random()*2.2
      particles.push({type:"spark",
        x:rk.x+Math.cos(ba)*7+(Math.random()-.5)*3,
        y:rk.y+Math.sin(ba)*7+(Math.random()-.5)*3,
        vx:Math.cos(ba+sp)*s, vy:Math.sin(ba+sp)*s,
        life:1, decay:.07,
        color:["#ff8800","#ffcc00","#ff4400","#ffee88"][Math.floor(Math.random()*4)]})
    }

    // Di chuyển theo đường ray (on-rails): chỉ owner tính logic
    // Client nhận rocket chỉ dùng để hiển thị — đồng bộ qua rocket_pos
    if (mode==="single" || rk.ownerId===myId) {
      let budget = SPEED
      while (budget > 0) {
        const wp = rk.wps[rk.wpIdx]
        if (!wp) { _rocketHit(rk); return false }
        const dx=wp.x-rk.x, dy=wp.y-rk.y
        const dist=Math.hypot(dx,dy)
        if (dist <= budget) {
          rk.x=wp.x; rk.y=wp.y
          rk.angle=Math.atan2(dy,dx)
          budget-=dist
          rk.wpIdx++
          if (rk.wpIdx>=rk.wps.length) { _rocketHit(rk); return false }
        } else {
          rk.angle=Math.atan2(dy,dx)
          rk.x+=dx/dist*budget
          rk.y+=dy/dist*budget
          budget=0
        }
      }
      // Va chạm target
      const target=players[rk.targetId]
      if (target&&target.alive!==false&&Math.hypot(rk.x-target.x,rk.y-target.y)<CFG.TANK.SIZE*0.9) {
        _rocketHit(rk); return false
      }
      // Sync vị trí cho client khác (mỗi 3 frame để giảm traffic)
      if (mode==="multi"&&socket&&myRoom) {
        rk._syncTimer=(rk._syncTimer||0)+1
        if (rk._syncTimer%3===0)
          socket.emit("rocket_pos",{room:myRoom,rid:rk.rid,
            x:rk.x,y:rk.y,angle:rk.angle})
      }
    }

    // Visual angle: xoay mượt theo hướng thực để trông thực tế khi bẻ góc
    let vdiff = rk.angle - rk.visualAngle
    while(vdiff>Math.PI)  vdiff-=Math.PI*2
    while(vdiff<-Math.PI) vdiff+=Math.PI*2
    rk.visualAngle += Math.sign(vdiff)*Math.min(Math.abs(vdiff), VISUAL_TURN)

    // Bank angle: liệng theo tốc độ xoay — tạo cảm giác nặng khi bẻ cua
    // vdiff > 0 → đang rẽ phải → liệng phải (dương), ngược lại liệng trái
    const targetBank = vdiff * 3.5   // khuếch đại góc liệng
    rk.bankAngle = (rk.bankAngle||0) + (targetBank - (rk.bankAngle||0)) * 0.15
    rk.bankAngle = Math.max(-0.7, Math.min(0.7, rk.bankAngle))  // clamp ±40°

    return true
  })
}


function drawRockets() {
  rockets.forEach(rk=>{
    if (rk.done) return
    const VA = rk.visualAngle
    const BANK = rk.bankAngle || 0

    // ── Trail: vệt lửa dày dần về phía mũi ──
    for (let i=1; i<rk.trail.length; i++) {
      const a=rk.trail[i], b=rk.trail[i-1]
      const li = i / rk.trail.length
      ctx.save()
      ctx.globalAlpha = a.life * li * 0.6
      ctx.strokeStyle = `hsl(${15+li*25},100%,${35+li*25}%)`
      ctx.lineWidth = 2 + 4*li*a.life
      ctx.lineCap = "round"
      ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.lineTo(a.x,a.y); ctx.stroke()
      ctx.restore()
    }

    // ── Glow hào quang ──
    ctx.save()
    const glowR = 20 + Math.abs(BANK)*10
    const gr = ctx.createRadialGradient(rk.x,rk.y,0,rk.x,rk.y,glowR)
    gr.addColorStop(0,"rgba(255,200,80,0.4)")
    gr.addColorStop(0.5,"rgba(255,100,0,0.15)")
    gr.addColorStop(1,"rgba(255,60,0,0)")
    ctx.fillStyle=gr
    ctx.beginPath(); ctx.arc(rk.x,rk.y,glowR,0,Math.PI*2); ctx.fill()
    ctx.restore()

    // ── Thân rocket: xoay visualAngle + liệng bankAngle ──
    ctx.save()
    ctx.translate(rk.x, rk.y)
    ctx.rotate(VA)

    // Liệng: scale Y theo cos(bank) tạo hiệu ứng nghiêng trong 2D
    const bankScale = Math.cos(BANK)           // 1.0 → ~0.76 khi bank 40°
    const bankShift = Math.sin(BANK) * CFG.TANK.SIZE * 0.18  // dịch thân lên/xuống
    ctx.transform(1, 0, 0, bankScale, 0, bankShift)

    const S = CFG.TANK.SIZE * 0.52
    ctx.shadowColor="#ff7700"; ctx.shadowBlur=12

    // Cánh đuôi (vẽ trước thân để bị che)
    // Cánh dưới (xa khi bank) — nhạt hơn
    const wingAlphaFar  = 0.55 + Math.min(0, BANK) * 0.5   // bank phải → cánh dưới mờ
    const wingAlphaNear = 0.55 + Math.max(0, BANK) * 0.5
    ctx.save()
    ctx.globalAlpha = Math.max(0.25, wingAlphaFar)
    ctx.fillStyle="#661100"
    ctx.beginPath()
    ctx.moveTo(-S*.38, S*.17); ctx.lineTo(-S*.78, S*.50); ctx.lineTo(-S*.52, S*.17)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle="#994422"; ctx.lineWidth=0.8; ctx.stroke()
    ctx.restore()

    // Cánh trên (gần khi bank dương)
    ctx.save()
    ctx.globalAlpha = Math.max(0.25, wingAlphaNear)
    ctx.fillStyle="#882200"
    ctx.beginPath()
    ctx.moveTo(-S*.38,-S*.17); ctx.lineTo(-S*.78,-S*.50); ctx.lineTo(-S*.52,-S*.17)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle="#bb5533"; ctx.lineWidth=0.8; ctx.stroke()
    ctx.restore()

    // Thân chính
    const bodyGrad=ctx.createLinearGradient(-S*.5,-S*.22,S*.9,S*.22)
    bodyGrad.addColorStop(0,"#7a1e00")
    bodyGrad.addColorStop(0.35,"#cc3a00")
    bodyGrad.addColorStop(0.7,"#ee5500")
    bodyGrad.addColorStop(1,"#ff7733")
    ctx.fillStyle=bodyGrad
    ctx.beginPath()
    ctx.moveTo(S*.9, 0)
    ctx.lineTo(S*.32, -S*.22)
    ctx.lineTo(-S*.5, -S*.17)
    ctx.lineTo(-S*.5,  S*.17)
    ctx.lineTo(S*.32,  S*.22)
    ctx.closePath(); ctx.fill()

    // Highlight sọc sáng giữa thân
    ctx.fillStyle="rgba(255,220,120,0.4)"
    ctx.beginPath()
    ctx.moveTo(S*.82, 0); ctx.lineTo(S*.2,-S*.1); ctx.lineTo(-S*.15,-S*.08)
    ctx.lineTo(-S*.15, S*.08); ctx.lineTo(S*.2, S*.1); ctx.closePath(); ctx.fill()

    // Mũi nhọn
    ctx.fillStyle="#ffcc66"
    ctx.shadowColor="#ffff99"; ctx.shadowBlur=8
    ctx.beginPath()
    ctx.moveTo(S*.9,0); ctx.lineTo(S*.5,-S*.1); ctx.lineTo(S*.5,S*.1)
    ctx.closePath(); ctx.fill()

    // Vòng ốc giữa thân (chi tiết)
    ctx.fillStyle="rgba(0,0,0,0.3)"
    ctx.beginPath(); ctx.arc(S*.05,0,S*.07,0,Math.PI*2); ctx.fill()
    ctx.fillStyle="rgba(255,180,80,0.6)"
    ctx.beginPath(); ctx.arc(S*.05,0,S*.04,0,Math.PI*2); ctx.fill()

    // Lửa đuôi flicker — 2 lớp
    const fl = 0.7 + Math.random()*0.65
    const fl2= 0.4 + Math.random()*0.4
    // Lớp ngoài mờ
    const fg1=ctx.createRadialGradient(-S*.5,0,0,-S*.5,0,S*.7*fl)
    fg1.addColorStop(0,"rgba(255,255,200,0.0)")
    fg1.addColorStop(0.3,"rgba(255,120,0,0.3)")
    fg1.addColorStop(1,"rgba(255,40,0,0)")
    ctx.fillStyle=fg1
    ctx.beginPath(); ctx.ellipse(-S*.5,0,S*.7*fl,S*.3,0,0,Math.PI*2); ctx.fill()
    // Lớp trong sáng
    const fg2=ctx.createRadialGradient(-S*.48,0,0,-S*.48,0,S*.5*fl2)
    fg2.addColorStop(0,"rgba(255,255,220,1)")
    fg2.addColorStop(0.2,"rgba(255,200,50,0.95)")
    fg2.addColorStop(0.55,"rgba(255,80,0,0.8)")
    fg2.addColorStop(1,"rgba(200,30,0,0)")
    ctx.fillStyle=fg2; ctx.shadowColor="#ffaa00"; ctx.shadowBlur=16
    ctx.beginPath(); ctx.ellipse(-S*.48,0,S*.5*fl2,S*.2*fl2,0,0,Math.PI*2); ctx.fill()

    ctx.restore()
  })
}

function drawTank(p) {
  ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.angle)
  const S=CFG.TANK.SIZE, H=S/2
  ctx.shadowColor="rgba(0,0,0,.4)"; ctx.shadowBlur=8; ctx.shadowOffsetY=3

  ctx.fillStyle="#111"
  ctx.fillRect(-H-5,-H+1,S+10,6); ctx.fillRect(-H-5,H-7,S+10,6)
  ctx.fillStyle="#2a2a2a"
  for(let i=0;i<5;i++){
    ctx.fillRect(-H-5+i*(S+10)/5,-H+2,2,4); ctx.fillRect(-H-5+i*(S+10)/5,H-6,2,4)
  }
  ctx.shadowBlur=0; ctx.shadowOffsetY=0
  ctx.fillStyle=SLOT_COLORS[p.slot!=null?p.slot:0]
  ctx.beginPath(); ctx.roundRect(-H,-H+3,S,S-6,5); ctx.fill()
  ctx.fillStyle="rgba(255,255,255,.2)"
  ctx.beginPath(); ctx.roundRect(-H+2,-H+5,S-4,(S-6)*.45,3); ctx.fill()
  ctx.fillStyle=SLOT_TURRET[p.slot!=null?p.slot:0]
  ctx.beginPath(); ctx.arc(0,0,H-3,0,Math.PI*2); ctx.fill()
  ctx.fillStyle="rgba(255,255,255,.15)"
  ctx.beginPath(); ctx.arc(-2,-3,H-7,0,Math.PI*2); ctx.fill()
  ctx.fillStyle="#1a1a1a"; ctx.fillRect(1,-3,S*.82,6)
  ctx.fillStyle="#111";    ctx.fillRect(S*.82,-4,6,8)
  // Nếu có rocket: vẽ rocket nhỏ gắn trên nòng
  if (p.power===5) {
    const RS=S*0.45
    ctx.shadowColor="#ff8800"; ctx.shadowBlur=10
    ctx.fillStyle="#cc4400"
    ctx.beginPath()
    ctx.moveTo(S*.82+RS*.7,0); ctx.lineTo(S*.82+RS*.1,-RS*.2)
    ctx.lineTo(S*.82-RS*.3,-RS*.16); ctx.lineTo(S*.82-RS*.3,RS*.16)
    ctx.lineTo(S*.82+RS*.1,RS*.2); ctx.closePath(); ctx.fill()
    ctx.fillStyle="#ff7722"
    ctx.beginPath()
    ctx.moveTo(S*.82+RS*.6,0); ctx.lineTo(S*.82+RS*.05,-RS*.1)
    ctx.lineTo(S*.82-RS*.1,-RS*.08); ctx.lineTo(S*.82-RS*.1,RS*.08)
    ctx.lineTo(S*.82+RS*.05,RS*.1); ctx.closePath(); ctx.fill()
    // Cánh nhỏ
    ctx.fillStyle="#993300"
    ctx.beginPath(); ctx.moveTo(S*.82-RS*.28,-RS*.16); ctx.lineTo(S*.82-RS*.5,-RS*.34); ctx.lineTo(S*.82-RS*.35,-RS*.16); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(S*.82-RS*.28,RS*.16);  ctx.lineTo(S*.82-RS*.5,RS*.34);  ctx.lineTo(S*.82-RS*.35,RS*.16);  ctx.closePath(); ctx.fill()
  }
  ctx.restore()
}

/* ── HUD ─────────────────────────────────────────────────────────────────── */
function updateHUD() {
  const hudEl = document.getElementById("hud-dynamic")
  if (!hudEl) return
  const pList = Object.values(players).sort((a,b)=>(a.slot||0)-(b.slot||0))
  const isScore = roomSettings.game_mode === "score"
  const limit   = roomSettings.score_limit

  if (pList.length !== hudEl._lastCount) {
    hudEl._lastCount = pList.length
    hudEl.innerHTML = pList.map(p => {
      const c = SLOT_COLORS[p.slot||0]
      const killLabel = isScore
        ? `<span id="hk-${p.id}">0</span>/<span style="opacity:.5">${limit}</span>`
        : `<span id="hk-${p.id}">0</span>`
      return `
      <div class="hud-card" style="border-left:3px solid ${c}">
        <div class="hud-avatar" style="background:${c}22;color:${c}">P${(p.slot||0)+1}</div>
        <div class="hud-info">
          <div class="hud-name" id="hn-${p.id}">${escHtml(p.name)}</div>
          <div class="hud-bar-wrap"><div class="hud-bar" id="hb-${p.id}" style="width:100%;background:${c}"></div></div>
        </div>
        <div class="hud-stats">
          <span class="hud-hp-num" id="hh-${p.id}" style="color:${c}">100</span>
          <span class="hud-kills">⚔ ${killLabel}</span>
        </div>
      </div>`
    }).join('<div class="hud-vs">·</div>')
  }
  pList.forEach(p => {
    const hp = Math.max(0, p.hp||0)
    const hb = document.getElementById(`hb-${p.id}`)
    const hh = document.getElementById(`hh-${p.id}`)
    const hk = document.getElementById(`hk-${p.id}`)
    const hn = document.getElementById(`hn-${p.id}`)
    if (hb) hb.style.width = hp + "%"
    if (hh) hh.textContent = hp
    if (hk) hk.textContent = p.score||0
    if (hn) hn.textContent = p.name
  })
}

/* ── CHAT ────────────────────────────────────────────────────────────────── */
const MAX_CHAT_MSGS = 200   // giữ tối đa 200 tin

function appendChatMsg(name, text, slot) {
  const log = document.getElementById("chatLog")
  if (!log) return
  const isMe = (slot === mySlot)
  const div = document.createElement("div")
  div.className = "chat-msg " + (isMe ? "chat-me" : "chat-them")
  const color = SLOT_COLORS[slot] || "#888"
  const time = new Date().toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})
  div.innerHTML = `<span class="chat-name" style="color:${color}">${escHtml(name)}<span class="chat-time">${time}</span></span><span class="chat-bubble" style="${isMe?`background:${color}`:""}"> ${escHtml(text)}</span>`
  log.appendChild(div)
  // Giới hạn số tin nhắn tối đa
  while (log.children.length > MAX_CHAT_MSGS) log.removeChild(log.firstChild)
  // Chỉ auto-scroll nếu đang ở gần cuối
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60
  if (atBottom) log.scrollTop = log.scrollHeight
  // Badge notification nếu chat đang thu nhỏ
  if (window._onNewChatMsg && !isMe) window._onNewChatMsg()
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
}

function sendChat() {
  const inp = document.getElementById("chatInput")
  if (!inp) return
  const text = inp.value.trim()
  if (!text || !socket || !myRoom) return
  inp.value = ""
  const me = players[myId]
  const name = me ? me.name : (pendingName || "Player")
  
  appendChatMsg(name, text, mySlot)
  socket.emit("chat_msg", {room: myRoom, name, text, slot: mySlot})
}


document.addEventListener("DOMContentLoaded", () => {
  const inp = document.getElementById("chatInput")
  if (inp) {
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); sendChat() }
    
      e.stopPropagation()
    })
    inp.addEventListener("keyup",  e => e.stopPropagation())
    inp.addEventListener("focus",  () => { for(const k in keys) keys[k]=false })
  }
  const btn = document.getElementById("chatSend")
  if (btn) btn.addEventListener("click", sendChat)
})