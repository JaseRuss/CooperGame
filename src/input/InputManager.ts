export interface InputState {
  /** -1 (reverse) .. 1 (forward) */
  throttle: number;
  /** -1 (turn left) .. 1 (turn right) */
  steer: number;
  /** Left-stick direction relative to the camera: +X right, +Y away from camera. Zero when idle. */
  moveX: number;
  moveY: number;
  /** turret yaw change this frame, radians */
  aimYawDelta: number;
  /** turret/barrel pitch change this frame, radians */
  aimPitchDelta: number;
  firing: boolean;
  /** Held: the short-range jam cannon (E / left trigger). */
  jamFiring: boolean;
  cameraTogglePressed: boolean;
  resetPressed: boolean;
  mapTogglePressed: boolean;
  rocketPressed: boolean;
  /** A salvo of drunken AA missiles (Q / right bumper). */
  aaPressed: boolean;
  buddyPressed: boolean;
  usingGamepad: boolean;
  pointerLocked: boolean;
  /** False once the browser has refused pointer lock; the mouse aims unlocked instead. */
  pointerLockAvailable: boolean;
  /** Menu navigation, one step per press (D-pad / left stick / arrows, A / Enter, B / Esc, X / O). */
  menu: MenuInput;
}

export interface MenuInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  options: boolean;
}

const MENU_STICK = 0.6;

const DEADZONE = 0.15;

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0;
  const sign = Math.sign(v);
  return sign * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE));
}

export class InputManager {
  private keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private mouseDown = false;
  private cameraKeyLatch = false;
  private gamepadCameraLatch = false;
  private resetKeyLatch = false;
  private gamepadResetLatch = false;
  private pointerLocked = false;
  /** Set once the browser refuses pointer lock (some embedded browsers do); the mouse then aims unlocked. */
  private pointerLockRefused = false;
  /** Cursor position over the game (0..1 across the window), or null when it's outside. */
  private cursor: { x: number; y: number } | null = null;

  private static readonly MOUSE_SENSITIVITY = 0.0024;
  private static readonly GAMEPAD_YAW_SPEED = 2.6; // rad/sec at full deflection
  private static readonly GAMEPAD_PITCH_SPEED = 0.9;
  private mouseSensitivity = InputManager.MOUSE_SENSITIVITY;
  private gamepadYawSpeed = InputManager.GAMEPAD_YAW_SPEED;
  private gamepadPitchSpeed = InputManager.GAMEPAD_PITCH_SPEED;
  private readonly menuLatch = new Map<keyof MenuInput, boolean>();
  private mapKeyLatch = false;
  private gamepadMapLatch = false;
  private rocketLatch = false;
  private aaLatch = false;
  private buddyLatch = false;
  private rightMouseDown = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('click', () => {
      if (this.pointerLocked) return;
      // Some embedded browsers refuse pointer lock; aiming still works via controller.
      Promise.resolve(canvas.requestPointerLock()).catch(() => {});
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('pointerlockerror', () => {
      this.pointerLockRefused = true;
    });

    // Locked: every movement aims. Unlocked: movement over the game still aims, and the cursor's
    // position is kept so holding it near an edge keeps the turret turning.
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked || e.target === canvas) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
      this.cursor = e.target === canvas ? { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight } : null;
    });
    document.addEventListener('mouseleave', () => {
      this.cursor = null;
    });
    window.addEventListener('blur', () => {
      this.cursor = null;
      this.mouseDown = false;
    });
    canvas.style.cursor = 'crosshair';
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.rightMouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightMouseDown = false;
    });

    // Prevent the browser context menu from eating right-click (reserved for future use).
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Scales mouse and right-stick turret speed (1 = normal). */
  setAimScale(scale: number): void {
    this.mouseSensitivity = InputManager.MOUSE_SENSITIVITY * scale;
    this.gamepadYawSpeed = InputManager.GAMEPAD_YAW_SPEED * scale;
    this.gamepadPitchSpeed = InputManager.GAMEPAD_PITCH_SPEED * scale;
  }

  /** Turns this frame's held menu buttons into one-shot presses. */
  private menuEdges(held: MenuInput): MenuInput {
    const out = { ...held };
    for (const key of Object.keys(held) as (keyof MenuInput)[]) {
      out[key] = held[key] && !this.menuLatch.get(key);
      this.menuLatch.set(key, held[key]);
    }
    return out;
  }

  /** Poll device state and produce a single frame's InputState. Call once per frame. */
  update(dt: number): InputState {
    let throttle = 0;
    let steer = 0;
    let moveX = 0;
    let moveY = 0;
    let aimYawDelta = 0;
    let aimPitchDelta = 0;
    let firing = this.mouseDown || this.keys.has('Space');
    let jamFiring = this.keys.has('KeyE');
    let usingGamepad = false;
    let cameraTogglePressed = false;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer -= 1;

    const cameraKeyHeld = this.keys.has('KeyC');
    if (cameraKeyHeld && !this.cameraKeyLatch) cameraTogglePressed = true;
    this.cameraKeyLatch = cameraKeyHeld;

    let resetPressed = false;
    const resetKeyHeld = this.keys.has('KeyR');
    if (resetKeyHeld && !this.resetKeyLatch) resetPressed = true;
    this.resetKeyLatch = resetKeyHeld;

    let mapTogglePressed = false;
    const mapKeyHeld = this.keys.has('KeyM');
    if (mapKeyHeld && !this.mapKeyLatch) mapTogglePressed = true;
    this.mapKeyLatch = mapKeyHeld;

    aimYawDelta += this.mouseDX * this.mouseSensitivity;
    aimPitchDelta += this.mouseDY * this.mouseSensitivity;
    // Unlocked mouse: park the cursor near the left or right edge to keep turning.
    if (!this.pointerLocked && this.cursor) {
      const edge = 0.07;
      const push = this.cursor.x < edge ? -(edge - this.cursor.x) / edge : this.cursor.x > 1 - edge ? (this.cursor.x - (1 - edge)) / edge : 0;
      aimYawDelta += push * this.gamepadYawSpeed * 0.8 * dt;
    }
    this.mouseDX = 0;
    this.mouseDY = 0;

    // Button holds are OR-ed across every connected pad *before* edge detection. Windows often
    // lists extra devices (headsets, duplicate XInput entries); checking each pad against a
    // shared latch let an idle one re-arm it every frame, so a held button toggled repeatedly.
    let camButtonHeld = false;
    let resetButtonHeld = false;
    let mapButtonHeld = false;
    let rocketHeld = this.keys.has('KeyF') || this.rightMouseDown;
    let buddyHeld = this.keys.has('KeyX');
    let aaHeld = this.keys.has('KeyQ');
    const k = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    const menuHeld: MenuInput = {
      up: k('ArrowUp', 'KeyW'),
      down: k('ArrowDown', 'KeyS'),
      left: k('ArrowLeft', 'KeyA'),
      right: k('ArrowRight', 'KeyD'),
      confirm: k('Enter', 'Space'),
      back: k('Escape', 'Backspace'),
      options: k('KeyO'),
    };

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const rx = applyDeadzone(pad.axes[2] ?? 0);
      const ry = applyDeadzone(pad.axes[3] ?? 0);

      // Radial deadzone on the left stick so every direction responds evenly.
      const rawX = pad.axes[0] ?? 0;
      const rawY = pad.axes[1] ?? 0;
      const rawLen = Math.hypot(rawX, rawY);
      if (rawLen > DEADZONE) {
        const scaled = Math.min(1, (rawLen - DEADZONE) / (1 - DEADZONE)) / rawLen;
        moveX += rawX * scaled;
        moveY += -rawY * scaled;
        usingGamepad = true;
      }
      if (rx !== 0 || ry !== 0) {
        // Squared response gives fine control near centre and fast traverse at full tilt.
        aimYawDelta += Math.sign(rx) * rx * rx * this.gamepadYawSpeed * dt;
        aimPitchDelta += Math.sign(ry) * ry * ry * this.gamepadPitchSpeed * dt;
        usingGamepad = true;
      }

      const rightTrigger = pad.buttons[7]?.value ?? 0;
      const fireButton = pad.buttons[0]?.pressed ?? false;
      if (rightTrigger > 0.2 || fireButton) {
        firing = true;
        usingGamepad = true;
      }
      if ((pad.buttons[6]?.value ?? 0) > 0.2) {
        jamFiring = true; // LT / L2
        usingGamepad = true;
      }

      camButtonHeld ||= pad.buttons[3]?.pressed ?? false; // Y / Triangle
      resetButtonHeld ||= pad.buttons[8]?.pressed ?? false; // Back / View / Share
      mapButtonHeld ||= pad.buttons[9]?.pressed ?? false; // Start / Menu / Options
      rocketHeld ||= pad.buttons[4]?.pressed ?? false; // LB / L1
      aaHeld ||= pad.buttons[5]?.pressed ?? false; // RB / R1
      buddyHeld ||= pad.buttons[2]?.pressed ?? false; // X / Square

      const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
      menuHeld.up ||= btn(12) || rawY < -MENU_STICK;
      menuHeld.down ||= btn(13) || rawY > MENU_STICK;
      menuHeld.left ||= btn(14) || rawX < -MENU_STICK;
      menuHeld.right ||= btn(15) || rawX > MENU_STICK;
      menuHeld.confirm ||= btn(0);
      menuHeld.back ||= btn(1);
      menuHeld.options ||= btn(2);
    }

    const rocketPressed = rocketHeld && !this.rocketLatch;
    this.rocketLatch = rocketHeld;
    const aaPressed = aaHeld && !this.aaLatch;
    this.aaLatch = aaHeld;
    const buddyPressed = buddyHeld && !this.buddyLatch;
    this.buddyLatch = buddyHeld;

    if (camButtonHeld && !this.gamepadCameraLatch) cameraTogglePressed = true;
    this.gamepadCameraLatch = camButtonHeld;
    if (resetButtonHeld && !this.gamepadResetLatch) resetPressed = true;
    this.gamepadResetLatch = resetButtonHeld;
    if (mapButtonHeld && !this.gamepadMapLatch) mapTogglePressed = true;
    this.gamepadMapLatch = mapButtonHeld;

    throttle = Math.max(-1, Math.min(1, throttle));
    steer = Math.max(-1, Math.min(1, steer));
    const moveLen = Math.hypot(moveX, moveY);
    if (moveLen > 1) {
      moveX /= moveLen;
      moveY /= moveLen;
    }

    return {
      throttle,
      steer,
      moveX,
      moveY,
      aimYawDelta,
      aimPitchDelta,
      firing,
      jamFiring,
      cameraTogglePressed,
      resetPressed,
      mapTogglePressed,
      rocketPressed,
      aaPressed,
      buddyPressed,
      usingGamepad,
      pointerLocked: this.pointerLocked,
      pointerLockAvailable: !this.pointerLockRefused,
      menu: this.menuEdges(menuHeld),
    };
  }
}
