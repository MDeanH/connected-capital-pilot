import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { DATA, buildEnvironment, disposeScene, WORLD_RADIUS } from './market3dScene'
import type { MacroSeries, Metro } from './market3dScene'
import {
  HOLD_YEARS, MAX_PICKS, MISSIONS, MISSION_TEXT,
  drawHistogram, loadBest, loadMissionsDone, quickPreview, rankFor, runDiligence,
  saveBest, saveMissionsDone,
} from './market3dGame'
import type { Preview, RunResult } from './market3dGame'
import { createSfx, loadMuted, saveMuted } from './market3dSfx'

const SCAN_RADIUS = 7.5
const ORB_RADIUS = 3.2
const MAP_SIZE = 132

function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : `${(v * 100).toFixed(digits)}%`
}

function soloMedian(m: Metro): number {
  return Math.exp(Math.log(1 + m.mu) - 0.5 * m.sigma * m.sigma) - 1
}

function tooltipHtml(d: Record<string, unknown>): string {
  if (d.kind === 'metro') {
    const m = d as unknown as Metro
    return (
      `<strong>#${m.rank} ${m.name}</strong><br/>` +
      `Home-value growth <strong>${fmtPct(m.mu)}/yr</strong> • de-smoothed σ <strong>${fmtPct(m.sigma)}</strong><br/>` +
      `${m.rentMu != null ? `Rent growth ${fmtPct(m.rentMu)}/yr • ` : ''}${m.n} monthly obs (Zillow ZHVI${m.rentMu != null ? ' + ZORI' : ''})`
    )
  }
  if (d.kind === 'macro') {
    const s = d as unknown as MacroSeries
    return (
      `<strong>${s.name}</strong> <span style="opacity:.7">(${s.id})</span><br/>` +
      `Latest <strong>${s.latest.toLocaleString()}</strong> • YoY <strong>${s.yoy == null ? '—' : s.yoy.toFixed(2) + '%'}</strong><br/>` +
      `${s.category}${s.annReturn != null ? ` • ann. return ${fmtPct(s.annReturn)} • σ* ${fmtPct(s.annVol)}` : ''}`
    )
  }
  return `<strong>${d.title}</strong><br/>${d.detail}`
}

interface SceneApi {
  setBeacon(name: string, on: boolean): void
  setOrbVisible(id: string, visible: boolean): void
}

const hudPanel: React.CSSProperties = {
  position: 'absolute', zIndex: 2,
  background: 'rgba(8,12,24,0.8)', border: '1px solid #22304f', borderRadius: 10,
  padding: '10px 14px', color: '#c4d3f2', fontSize: '0.78rem', lineHeight: 1.55,
}
const btnStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: '0.78rem', borderRadius: 8, cursor: 'pointer',
}

export default function Market3D() {
  const mountRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLCanvasElement>(null)
  const histRef = useRef<HTMLCanvasElement>(null)
  const compassRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<SceneApi | null>(null)

  const sfxRef = useRef<ReturnType<typeof createSfx> | null>(null)
  if (!sfxRef.current) sfxRef.current = createSfx(loadMuted())
  const sfx = sfxRef.current

  const [mode, setMode] = useState<'game' | 'orbit'>('game')
  const [autoRotate, setAutoRotate] = useState(true)
  const [intro, setIntro] = useState(true)
  const [muted, setMuted] = useState(loadMuted())
  const [picks, setPicks] = useState<Metro[]>([])
  const [nearby, setNearby] = useState<Metro | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [orbFacts, setOrbFacts] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [results, setResults] = useState<RunResult | null>(null)
  const [totalOrbs, setTotalOrbs] = useState(8)
  const [missionsDone, setMissionsDone] = useState<string[]>(loadMissionsDone())
  const [missionsOpen, setMissionsOpen] = useState(false)
  const [newMissions, setNewMissions] = useState<string[]>([])
  const [best, setBest] = useState(loadBest())
  const [newBest, setNewBest] = useState(false)

  const autoRotateRef = useRef(autoRotate); autoRotateRef.current = autoRotate
  const introRef = useRef(intro); introRef.current = intro
  const picksRef = useRef(picks); picksRef.current = picks
  const nearbyRef = useRef(nearby); nearbyRef.current = nearby
  const resultsRef = useRef(results); resultsRef.current = results
  const missionsDoneRef = useRef(missionsDone); missionsDoneRef.current = missionsDone
  const bestRef = useRef(best); bestRef.current = best
  const totalOrbsRef = useRef(totalOrbs); totalOrbsRef.current = totalOrbs
  const collectedRef = useRef<Set<string>>(new Set())
  const baselineRef = useRef(0.0427)
  const startRef = useRef(performance.now())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, ms = 4000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])

  const togglePick = useCallback((m: Metro) => {
    setPicks(prev => {
      if (prev.some(p => p.name === m.name)) {
        apiRef.current?.setBeacon(m.name, false)
        sfx.remove()
        return prev.filter(p => p.name !== m.name)
      }
      if (prev.length >= MAX_PICKS) {
        showToast(`Portfolio full (${MAX_PICKS}) — remove a pick first.`)
        return prev
      }
      apiRef.current?.setBeacon(m.name, true)
      sfx.acquire()
      showToast(`Acquired ${m.name} — growth ${fmtPct(m.mu)}/yr, σ ${fmtPct(m.sigma)}`)
      return [...prev, m]
    })
  }, [sfx, showToast])
  const togglePickRef = useRef(togglePick); togglePickRef.current = togglePick

  const collectOrb = useCallback((id: string, fact: string) => {
    if (collectedRef.current.has(id)) return
    collectedRef.current.add(id)
    apiRef.current?.setOrbVisible(id, false)
    sfx.orb()
    setOrbFacts(prev => [...prev, fact])
    showToast(`📀 DATA ORB — ${fact}`, 11000)
  }, [sfx, showToast])
  const collectOrbRef = useRef(collectOrb); collectOrbRef.current = collectOrb

  const doRun = useCallback(() => {
    const p = picksRef.current
    if (p.length === 0) {
      showToast('Acquire at least one metro first (fly close, press E).')
      return
    }
    const res = runDiligence(
      p, baselineRef.current, collectedRef.current.size, totalOrbsRef.current,
      (performance.now() - startRef.current) / 1000,
    )
    const earned = MISSIONS.filter(m => m.check(res)).map(m => m.id)
    const fresh = earned.filter(id => !missionsDoneRef.current.includes(id))
    if (fresh.length > 0) {
      const all = [...missionsDoneRef.current, ...fresh]
      setMissionsDone(all)
      saveMissionsDone(all)
      sfx.mission()
    } else {
      sfx.results()
    }
    setNewMissions(fresh)
    const isBest = res.score > bestRef.current
    setNewBest(isBest)
    if (isBest) { setBest(res.score); saveBest(res.score) }
    setResults(res)
  }, [sfx, showToast])
  const doRunRef = useRef(doRun); doRunRef.current = doRun

  const resetRun = useCallback(() => {
    picksRef.current.forEach(p => apiRef.current?.setBeacon(p.name, false))
    collectedRef.current.forEach(id => apiRef.current?.setOrbVisible(id, true))
    collectedRef.current.clear()
    setPicks([]); setOrbFacts([]); setResults(null); setNewMissions([]); setNewBest(false)
    startRef.current = performance.now()
    showToast('New run — the city is yours. Good hunting.')
  }, [showToast])

  // Live portfolio preview (correlated mini-MC) whenever the book changes
  useEffect(() => {
    setPreview(picks.length > 0 ? quickPreview(picks, baselineRef.current) : null)
  }, [picks])

  // Results histogram
  useEffect(() => {
    if (results && histRef.current) drawHistogram(histRef.current, results)
  }, [results])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 600)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    mount.appendChild(renderer.domElement)

    const handles = buildEnvironment(scene)
    baselineRef.current = handles.baselineCagr
    setTotalOrbs(handles.orbSpecs.length)
    totalOrbsRef.current = handles.orbSpecs.length

    // --- Beacons + orbs -----------------------------------------------------
    const beacons = new Map<string, THREE.Group>()
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.55 })
    const setBeacon = (name: string, on: boolean) => {
      const tower = handles.towers.get(name)
      if (!tower) return
      if (!on) {
        const b = beacons.get(name)
        if (b) { scene.remove(b); beacons.delete(name) }
        return
      }
      if (beacons.has(name)) return
      const g = new THREE.Group()
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 60, 10), beaconMat)
      beam.position.y = 30
      g.add(beam)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.09, 10, 32).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
      )
      ring.position.y = tower.scale.y + 0.7
      g.add(ring)
      g.position.set(tower.position.x, 0, tower.position.z)
      scene.add(g)
      beacons.set(name, g)
    }

    const orbGeo = new THREE.IcosahedronGeometry(0.9, 1)
    const orbs = new Map<string, THREE.Mesh>()
    for (const spec of handles.orbSpecs) {
      const orb = new THREE.Mesh(orbGeo, new THREE.MeshStandardMaterial({
        color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.4, roughness: 0.2,
      }))
      orb.position.copy(spec.position)
      orb.visible = !collectedRef.current.has(spec.id)
      orb.userData = spec
      scene.add(orb)
      orbs.set(spec.id, orb)
    }
    apiRef.current = {
      setBeacon,
      setOrbVisible: (id, visible) => { const o = orbs.get(id); if (o) o.visible = visible },
    }
    picksRef.current.forEach(p => setBeacon(p.name, true))

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.5, 0.65, 0.2,
    ))
    composer.addPass(new OutputPass())

    // --- Minimap static layer -----------------------------------------------
    const mapBg = document.createElement('canvas')
    mapBg.width = MAP_SIZE; mapBg.height = MAP_SIZE
    {
      const c = mapBg.getContext('2d')!
      const half = MAP_SIZE / 2, sc = (half - 6) / 120
      c.fillStyle = 'rgba(8,12,24,0.85)'
      c.beginPath(); c.arc(half, half, half - 1, 0, Math.PI * 2); c.fill()
      c.strokeStyle = '#22304f'
      c.beginPath(); c.arc(half, half, half - 1, 0, Math.PI * 2); c.stroke()
      c.fillStyle = '#475569'
      handles.towers.forEach(t => c.fillRect(half + t.position.x * sc - 0.7, half + t.position.z * sc - 0.7, 1.4, 1.4))
      const line = (x1: number, z1: number, x2: number, z2: number, col: string) => {
        c.strokeStyle = col; c.lineWidth = 2
        c.beginPath(); c.moveTo(half + x1 * sc, half + z1 * sc); c.lineTo(half + x2 * sc, half + z2 * sc); c.stroke()
      }
      line(-43, -50, 43, -50, 'rgba(56,189,248,0.8)')   // ZHVI ridge
      line(-43, 50, 43, 50, 'rgba(245,158,11,0.8)')     // mortgage wall
      line(-50, -43, -50, 43, 'rgba(167,139,250,0.8)')  // housing starts
    }

    // --- Mode-specific controls ----------------------------------------------
    let controls: OrbitControls | null = null
    let drone: THREE.Group | null = null
    let compass: THREE.Mesh | null = null
    let trail: THREE.Points | null = null
    let trailIdx = 0
    const pos = new THREE.Vector3(0, 12, 44)
    const vel = new THREE.Vector3()
    let yaw = 0, pitch = -0.12
    const keys = new Set<string>()
    let highlighted: THREE.Mesh | null = null

    const onPointerMoveOrbit = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      const pointer = new THREE.Vector2(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(handles.pickables, false)[0]
      const tip = tipRef.current
      if (!tip) return
      if (hit) {
        tip.style.display = 'block'
        tip.style.left = `${ev.clientX - r.left + 14}px`
        tip.style.top = `${ev.clientY - r.top + 14}px`
        tip.innerHTML = tooltipHtml(hit.object.userData)
        renderer.domElement.style.cursor = 'pointer'
      } else {
        tip.style.display = 'none'
        renderer.domElement.style.cursor = 'grab'
      }
    }

    let dragging = false, lastX = 0, lastY = 0
    const onDown = (ev: PointerEvent) => {
      dragging = true; lastX = ev.clientX; lastY = ev.clientY
      renderer.domElement.setPointerCapture(ev.pointerId)
    }
    const onUp = () => { dragging = false }
    const onMoveGame = (ev: PointerEvent) => {
      if (!dragging) return
      yaw -= (ev.clientX - lastX) * 0.0035
      pitch = THREE.MathUtils.clamp(pitch - (ev.clientY - lastY) * 0.003, -1.25, 1.25)
      lastX = ev.clientX; lastY = ev.clientY
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (introRef.current) return
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.code)) ev.preventDefault()
      if (ev.code === 'KeyE' && !resultsRef.current) {
        const m = nearbyRef.current
        if (m) togglePickRef.current(m)
        return
      }
      if (ev.code === 'KeyR' && !resultsRef.current) { doRunRef.current(); return }
      if (ev.code === 'Escape') { setResults(null); return }
      keys.add(ev.code)
    }
    const onKeyUp = (ev: KeyboardEvent) => keys.delete(ev.code)

    if (mode === 'orbit') {
      camera.position.set(46, 30, 62)
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.target.set(0, 5, 0)
      controls.maxPolarAngle = 1.5
      controls.minDistance = 10
      controls.maxDistance = 220
      controls.autoRotateSpeed = 0.5
      renderer.domElement.addEventListener('pointermove', onPointerMoveOrbit)
    } else {
      drone = new THREE.Group()
      const body = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.55),
        new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x38bdf8, emissiveIntensity: 1.3, metalness: 0.5, roughness: 0.2 }),
      )
      drone.add(body)
      const glow = new THREE.PointLight(0x67e8f9, 60, 20)
      drone.add(glow)
      scene.add(drone)

      // Orb compass: a small cone above the drone pointing to the nearest orb
      const coneGeo = new THREE.ConeGeometry(0.22, 0.75, 12).rotateX(Math.PI / 2)
      compass = new THREE.Mesh(coneGeo, new THREE.MeshStandardMaterial({
        color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.6,
      }))
      scene.add(compass)

      // Glowing particle trail
      const TRAIL_N = 70
      const trailPos = new Float32Array(TRAIL_N * 3)
      for (let i = 0; i < TRAIL_N; i++) {
        trailPos[i * 3] = pos.x; trailPos[i * 3 + 1] = pos.y; trailPos[i * 3 + 2] = pos.z
      }
      const trailGeo = new THREE.BufferGeometry()
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3))
      trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
        color: 0x38bdf8, size: 0.3, transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      scene.add(trail)

      renderer.domElement.addEventListener('pointerdown', onDown)
      renderer.domElement.addEventListener('pointerup', onUp)
      renderer.domElement.addEventListener('pointermove', onMoveGame)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
    }

    const observer = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
    })
    observer.observe(mount)

    const clock = new THREE.Clock()
    let raf = 0
    let frame = 0
    const fwd = new THREE.Vector3(), flat = new THREE.Vector3(), right = new THREE.Vector3()
    const camGoal = new THREE.Vector3()

    const drawMinimap = () => {
      const cv = mapRef.current
      if (!cv) return
      const c = cv.getContext('2d')
      if (!c) return
      const half = MAP_SIZE / 2, sc = (half - 6) / 120
      c.clearRect(0, 0, MAP_SIZE, MAP_SIZE)
      c.drawImage(mapBg, 0, 0)
      orbs.forEach(o => {
        if (!o.visible) return
        c.fillStyle = '#22d3ee'
        c.beginPath(); c.arc(half + o.position.x * sc, half + o.position.z * sc, 2.4, 0, Math.PI * 2); c.fill()
      })
      c.fillStyle = '#fbbf24'
      for (const p of picksRef.current) {
        const t = handles.towers.get(p.name)
        if (t) { c.beginPath(); c.arc(half + t.position.x * sc, half + t.position.z * sc, 2.6, 0, Math.PI * 2); c.fill() }
      }
      // drone wedge oriented by yaw (forward = (-sin yaw, -cos yaw) in x,z)
      c.save()
      c.translate(half + pos.x * sc, half + pos.z * sc)
      c.rotate(Math.atan2(-Math.sin(yaw), -Math.cos(yaw)) - Math.PI / 2)
      c.fillStyle = '#ffffff'
      c.beginPath(); c.moveTo(3.6, 0); c.lineTo(-2.4, 2.2); c.lineTo(-2.4, -2.2); c.closePath(); c.fill()
      c.restore()
    }

    const animate = () => {
      raf = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const t = clock.elapsedTime
      frame++

      orbs.forEach((o, id) => {
        if (!o.visible) return
        o.rotation.y += dt * 1.4
        o.position.y = (o.userData as { position: THREE.Vector3 }).position.y + Math.sin(t * 2 + id.length) * 0.35
      })
      beacons.forEach(b => { b.children[1].rotation.z += dt * 2 })

      if (mode === 'orbit' && controls) {
        controls.autoRotate = autoRotateRef.current
        controls.update()
      } else if (drone) {
        fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
        flat.set(-Math.sin(yaw), 0, -Math.cos(yaw))
        right.set(-flat.z, 0, flat.x)
        const boost = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 2.25 : 1
        const A = 55 * boost
        if (!introRef.current) {
          if (keys.has('KeyW') || keys.has('ArrowUp')) vel.addScaledVector(fwd, A * dt)
          if (keys.has('KeyS') || keys.has('ArrowDown')) vel.addScaledVector(fwd, -A * dt)
          if (keys.has('KeyD') || keys.has('ArrowRight')) vel.addScaledVector(right, A * dt)
          if (keys.has('KeyA') || keys.has('ArrowLeft')) vel.addScaledVector(right, -A * dt)
          if (keys.has('Space')) vel.y += A * dt
          if (keys.has('KeyC')) vel.y -= A * dt
        }
        vel.multiplyScalar(Math.exp(-2.6 * dt))
        pos.addScaledVector(vel, dt)
        pos.y = THREE.MathUtils.clamp(pos.y, 1.2, 70)
        const r = Math.hypot(pos.x, pos.z)
        if (r > WORLD_RADIUS) { pos.x *= WORLD_RADIUS / r; pos.z *= WORLD_RADIUS / r }

        drone.position.copy(pos)
        drone.rotation.y = yaw
        drone.rotation.z = THREE.MathUtils.clamp(-vel.dot(right) * 0.045, -0.55, 0.55)
        drone.rotation.x = THREE.MathUtils.clamp(vel.dot(flat) * 0.015, -0.35, 0.35)
        drone.children[0].rotation.y += dt * 3

        if (trail && frame % 2 === 0) {
          const attr = trail.geometry.getAttribute('position') as THREE.BufferAttribute
          attr.setXYZ(trailIdx % 70, pos.x, pos.y - 0.3, pos.z)
          attr.needsUpdate = true
          trailIdx++
        }

        camGoal.copy(pos).addScaledVector(fwd, -9).add(new THREE.Vector3(0, 3.2, 0))
        camera.position.lerp(camGoal, 1 - Math.exp(-6 * dt))
        camera.lookAt(pos.x + fwd.x * 8, pos.y + fwd.y * 8, pos.z + fwd.z * 8)

        // Proximity scan
        let bestTower: THREE.Mesh | null = null
        let bestD = SCAN_RADIUS
        for (const tower of handles.towers.values()) {
          const d = Math.hypot(tower.position.x - pos.x, tower.position.z - pos.z)
          const inY = pos.y < tower.scale.y + 10
          if (d < bestD && inY) { bestD = d; bestTower = tower }
        }
        if (bestTower !== highlighted) {
          if (highlighted) (highlighted.material as THREE.MeshStandardMaterial).emissiveIntensity = 1
          highlighted = bestTower
          const m = bestTower ? (bestTower.userData as unknown as Metro) : null
          nearbyRef.current = m
          setNearby(m)
          if (m) sfx.scan()
        }
        if (highlighted) {
          ;(highlighted.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + Math.sin(t * 6) * 0.7
        }

        // Orb collection + compass to nearest orb
        let nearOrb: THREE.Mesh | null = null
        let nearD = Infinity
        orbs.forEach(o => {
          if (!o.visible) return
          const d = o.position.distanceTo(pos)
          if (d < ORB_RADIUS) {
            const spec = o.userData as { id: string; fact: string }
            collectOrbRef.current(spec.id, spec.fact)
            return
          }
          if (d < nearD) { nearD = d; nearOrb = o }
        })
        if (compass) {
          if (nearOrb) {
            compass.visible = true
            compass.position.set(pos.x, pos.y + 1.35, pos.z)
            compass.lookAt((nearOrb as THREE.Mesh).position)
            if (compassRef.current && frame % 12 === 0) {
              compassRef.current.textContent = `📡 nearest data orb ${Math.round(nearD)}m`
            }
          } else {
            compass.visible = false
            if (compassRef.current) compassRef.current.textContent = '📀 all orbs collected!'
          }
        }
        if (frame % 3 === 0) drawMinimap()
      }
      composer.render()
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMoveOrbit)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMoveGame)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      controls?.dispose()
      apiRef.current = null
      disposeScene(scene)
      composer.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [mode, sfx])

  const pickedNearby = nearby != null && picks.some(p => p.name === nearby.name)
  const doneCount = missionsDone.length

  return (
    <div style={{ position: 'relative', width: '100%', height: 'max(540px, calc(100vh - 230px))', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border, #1e293b)' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div ref={tipRef} style={{
        display: 'none', position: 'absolute', zIndex: 3, pointerEvents: 'none', maxWidth: 340,
        background: 'rgba(8,12,24,0.92)', border: '1px solid #2b3a5e', borderRadius: 8,
        padding: '8px 10px', color: '#dbe7ff', fontSize: '0.8rem', lineHeight: 1.45,
      }} />

      {/* Top-right controls */}
      <div style={{ position: 'absolute', zIndex: 4, top: 12, right: 12, display: 'flex', gap: 6 }}>
        <button
          onClick={() => { const m = !muted; setMuted(m); sfx.setMuted(m); saveMuted(m) }}
          style={btnStyle}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button onClick={() => setMode(m => (m === 'game' ? 'orbit' : 'game'))} style={btnStyle}>
          {mode === 'game' ? '📊 Analysis Orbit' : '🎮 Market Quest'}
        </button>
      </div>

      {/* GAME HUD */}
      {mode === 'game' && !intro && (
        <>
          <div style={{ ...hudPanel, top: 12, left: 12, maxWidth: 330 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>🎮 MARKET QUEST</div>
            <div style={{ marginTop: 4, opacity: 0.7 }}>
              <strong>WASD</strong> fly • <strong>Shift</strong> boost • <strong>Space/C</strong> up/down • <strong>drag</strong> look • <strong>E</strong> acquire • <strong>R</strong> run diligence
            </div>
            <div ref={compassRef} style={{ marginTop: 4, color: '#67e8f9' }}>📡 scanning…</div>
          </div>

          <div style={{ ...hudPanel, top: 52, right: 12, minWidth: 240, maxWidth: 310 }}>
            <div style={{ fontWeight: 700, color: '#fff' }}>
              Portfolio {picks.length}/{MAX_PICKS} <span style={{ opacity: 0.6, fontWeight: 400 }}>• orbs {orbFacts.length}/{totalOrbs} • best {best}</span>
            </div>
            {picks.length === 0 && <div style={{ opacity: 0.6, marginTop: 4 }}>No metros acquired yet.</div>}
            {picks.map(p => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4, alignItems: 'center' }}>
                <span>#{p.rank} {p.name} <span style={{ opacity: 0.65 }}>({fmtPct(p.mu)} • σ {fmtPct(p.sigma)})</span></span>
                <button onClick={() => togglePick(p)} style={{ fontSize: '0.7rem', padding: '1px 7px', borderRadius: 6, cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            {preview && (
              <div style={{ marginTop: 6, padding: '5px 8px', background: 'rgba(59,91,219,0.18)', border: '1px solid #3b5bdb', borderRadius: 7 }}>
                live book: median <strong>{fmtPct(preview.medianIRR)}</strong> • beat&nbsp;US <strong>{fmtPct(preview.pBeat, 0)}</strong> • loss <strong>{fmtPct(preview.pLoss, 1)}</strong>
              </div>
            )}
            <button
              onClick={doRun}
              disabled={picks.length === 0}
              style={{ marginTop: 8, width: '100%', padding: '7px 0', borderRadius: 8, cursor: picks.length ? 'pointer' : 'default', fontWeight: 700, background: picks.length ? '#3b5bdb' : '#1e293b', color: '#fff', border: 'none' }}
            >
              ▶ Run Diligence (R)
            </button>
            <div
              onClick={() => setMissionsOpen(o => !o)}
              style={{ marginTop: 7, cursor: 'pointer', fontWeight: 700, color: '#fff' }}
            >
              🏆 Missions {doneCount}/{MISSIONS.length} <span style={{ opacity: 0.6 }}>{missionsOpen ? '▾' : '▸'}</span>
            </div>
            {missionsOpen && MISSIONS.map(m => (
              <div key={m.id} style={{ marginTop: 3, opacity: missionsDone.includes(m.id) ? 1 : 0.65 }}>
                {missionsDone.includes(m.id) ? '✅' : '○'} <strong>{m.name}</strong>
                <div style={{ fontSize: '0.7rem', opacity: 0.7, marginLeft: 18 }}>{m.desc}</div>
              </div>
            ))}
          </div>

          <canvas
            ref={mapRef}
            width={MAP_SIZE}
            height={MAP_SIZE}
            style={{ position: 'absolute', zIndex: 2, bottom: 14, right: 14, borderRadius: '50%' }}
          />

          {nearby && !results && (
            <div style={{ ...hudPanel, bottom: 16, left: '50%', transform: 'translateX(-50%)', textAlign: 'center', border: '1px solid #3b5bdb' }}>
              <div style={{ fontWeight: 700, color: '#fff' }}>SCAN — #{nearby.rank} {nearby.name}</div>
              <div style={{ marginTop: 2 }}>
                growth <strong>{fmtPct(nearby.mu)}/yr</strong> • σ <strong>{fmtPct(nearby.sigma)}</strong>
                {nearby.rentMu != null && <> • rents {fmtPct(nearby.rentMu)}/yr</>} • solo median {fmtPct(soloMedian(nearby))}
              </div>
              <button onClick={() => togglePick(nearby)} style={{ marginTop: 6, padding: '4px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: 700 }}>
                {pickedNearby ? '✕ Remove from portfolio (E)' : '＋ Acquire (E)'}
              </button>
            </div>
          )}
        </>
      )}

      {/* ORBIT LEGEND */}
      {mode === 'orbit' && (
        <div style={{ ...hudPanel, top: 12, left: 12, maxWidth: 380 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>US Market — 3D Environment</div>
          <div style={{ opacity: 0.85, marginTop: 4 }}>
            <strong>City</strong>: 150 largest metros — height = home-value growth/yr,
            color = de-smoothed risk (<span style={{ color: '#2dd4bf' }}>calm</span> → <span style={{ color: '#f87171' }}>volatile</span>),
            center = biggest markets.<br />
            <strong>Ring</strong>: 17 macro indicators (<span style={{ color: '#4ade80' }}>rising</span> / <span style={{ color: '#f87171' }}>falling</span> YoY).<br />
            <strong>Ridges</strong>: ZHVI {DATA.zhvi.start.slice(0, 4)}–{DATA.zhvi.end.slice(0, 4)} • mortgage rate {DATA.mortgage.start.slice(0, 4)}–{DATA.mortgage.end.slice(0, 4)} • housing starts {DATA.houst.start.slice(0, 4)}–{DATA.houst.end.slice(0, 4)}.
          </div>
          <div style={{ marginTop: 6, opacity: 0.7 }}>Drag to orbit • scroll to zoom • hover anything for diligence stats.</div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRotate} onChange={e => setAutoRotate(e.target.checked)} /> Auto-rotate
          </label>
        </div>
      )}

      {/* TOAST */}
      {toast && !intro && (
        <div
          onClick={() => setToast(null)}
          style={{ ...hudPanel, bottom: 16, left: 12, maxWidth: 420, border: '1px solid #22d3ee', cursor: 'pointer', zIndex: 4 }}
        >
          {toast}
        </div>
      )}

      {/* INTRO */}
      {mode === 'game' && intro && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(3,5,12,0.8)' }}>
          <div style={{ ...hudPanel, position: 'relative', maxWidth: 540, width: '92%', maxHeight: '90%', overflowY: 'auto', fontSize: '0.85rem' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>🎮 MARKET QUEST</div>
            <div style={{ color: '#67e8f9', marginTop: 2 }}>A diligence scout's tour of the US housing market — every object is real data.</div>
            <div style={{ marginTop: 10, opacity: 0.9 }}>{MISSION_TEXT}</div>
            <div style={{ marginTop: 10, opacity: 0.9 }}>
              The Monte Carlo is <strong>correlated</strong>: metros share national and state shocks, so true
              diversification — not just five towers in Florida — is what protects your downside.
              Scores blend median IRR, conviction, risk, diversification and exploration.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 12, background: 'rgba(59,91,219,0.12)', border: '1px solid #2b3a5e', borderRadius: 8, padding: '8px 10px' }}>
              <div><strong>WASD</strong> — fly</div>
              <div><strong>drag</strong> — look around</div>
              <div><strong>Shift</strong> — boost</div>
              <div><strong>Space / C</strong> — climb / descend</div>
              <div><strong>E</strong> — acquire / remove metro</div>
              <div><strong>R</strong> — run diligence</div>
            </div>
            <div style={{ marginTop: 10, fontWeight: 700, color: '#fff' }}>Missions {doneCount}/{MISSIONS.length}</div>
            {MISSIONS.map(m => (
              <div key={m.id} style={{ marginTop: 2, opacity: missionsDone.includes(m.id) ? 1 : 0.7 }}>
                {missionsDone.includes(m.id) ? '✅' : '○'} <strong>{m.name}</strong> — {m.desc}
              </div>
            ))}
            {best > 0 && <div style={{ marginTop: 8, color: '#fbbf24' }}>Personal best: {best} pts ({rankFor(best)})</div>}
            <button
              onClick={() => { sfx.unlock(); setIntro(false); startRef.current = performance.now() }}
              style={{ marginTop: 12, width: '100%', padding: '10px 0', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: '1rem', background: '#3b5bdb', color: '#fff', border: 'none' }}
            >
              ▶ LAUNCH DRONE
            </button>
          </div>
        </div>
      )}

      {/* RESULTS */}
      {results && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(3,5,12,0.72)' }}>
          <div style={{ ...hudPanel, position: 'relative', maxWidth: 540, width: '92%', maxHeight: '88%', overflowY: 'auto', fontSize: '0.85rem' }}>
            {newBest && <div style={{ color: '#fbbf24', fontWeight: 800, letterSpacing: 1 }}>★ NEW PERSONAL BEST ★</div>}
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>
              🏅 {results.rank} <span style={{ color: '#fbbf24' }}>• {results.score} pts</span>
              <span style={{ opacity: 0.55, fontSize: '0.8rem', fontWeight: 400 }}> (best {best})</span>
            </div>
            {newMissions.map(id => {
              const m = MISSIONS.find(x => x.id === id)
              return m ? (
                <div key={id} style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(251,191,36,0.14)', border: '1px solid #fbbf24', borderRadius: 7, color: '#fde68a' }}>
                  🏆 MISSION COMPLETE — <strong>{m.name}</strong>
                </div>
              ) : null
            })}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
              <div>Median portfolio IRR ({HOLD_YEARS}-yr): <strong>{fmtPct(results.medianIRR)}</strong></div>
              <div>P(beat US {fmtPct(results.baseline, 2)}/yr): <strong>{fmtPct(results.pBeat, 0)}</strong></div>
              <div>P(loss): <strong>{fmtPct(results.pLoss, 1)}</strong></div>
              <div>States covered: <strong>{results.uniqueStates}</strong></div>
              <div>Data orbs: <strong>{results.orbs}/{results.totalOrbs}</strong></div>
              <div>Run time: <strong>{Math.floor(results.timeSec / 60)}m {Math.round(results.timeSec % 60)}s</strong></div>
            </div>
            <canvas ref={histRef} width={480} height={110} style={{ width: '100%', marginTop: 10, background: 'rgba(13,19,36,0.7)', borderRadius: 8 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginTop: 8, textAlign: 'center', fontSize: '0.72rem' }}>
              {([
                ['Median', results.parts.base],
                ['Conviction', results.parts.conviction],
                ['Risk', results.parts.risk],
                ['Diversity', results.parts.diversification],
                ['Exploration', results.parts.exploration],
              ] as const).map(([label, v]) => (
                <div key={label} style={{ background: 'rgba(59,91,219,0.12)', border: '1px solid #2b3a5e', borderRadius: 6, padding: '4px 2px' }}>
                  <div style={{ opacity: 0.65 }}>{label}</div>
                  <div style={{ fontWeight: 700, color: v < 0 ? '#f87171' : '#fff' }}>{v >= 0 ? '+' : ''}{v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontWeight: 700, color: '#fff' }}>Your book</div>
            {results.picks.map(p => (
              <div key={p.name} style={{ marginTop: 2 }}>
                #{p.rank} {p.name} — growth {fmtPct(p.mu)}/yr, σ {fmtPct(p.sigma)}, solo median {fmtPct(soloMedian(p))}
              </div>
            ))}
            {orbFacts.length > 0 && (
              <>
                <div style={{ marginTop: 10, fontWeight: 700, color: '#fff' }}>Field notes</div>
                {orbFacts.map((f, i) => <div key={i} style={{ marginTop: 3, opacity: 0.8 }}>📀 {f}</div>)}
              </>
            )}
            <div style={{ marginTop: 8, opacity: 0.6, fontSize: '0.75rem' }}>
              Correlated Monte Carlo: equal-weight lognormal paths sharing national (35%) and state (25%) variance factors —
              same-state picks move together, so spreading out genuinely cuts P(loss).
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setResults(null)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Keep exploring (Esc)</button>
              <button onClick={resetRun} style={{ flex: 1, padding: '7px 0', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>↺ New run</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
