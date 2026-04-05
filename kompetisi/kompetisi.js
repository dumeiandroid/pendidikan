/**
 * kompetisi.js
 * Shared library untuk fitur countdown sinkron:
 *   1. Countdown 10→0 saat kompetisi baru diaktifkan (startCountdown)
 *   2. Countdown menuju jam selesai (finishCountdown)
 *   3. Event hooks: onStartCountdownDone, onFinished
 *
 * Cara pakai di index.html / score.html:
 *   <script src="kompetisi.js"></script>
 *   Lalu panggil KompetisiCD.init(kontrolData, callbacks)
 *
 * Field yang dipakai di x_01 (kontrol_admin):
 *   kompetisi        : true/false
 *   waktu_per_soal   : number (detik)
 *   activated_at     : ISO string — timestamp saat admin klik ON + Simpan
 *   jam_selesai      : ISO string — jam selesai yang dipilih admin
 *   finished         : true/false — set true saat waktu habis (oleh client pertama yg detect)
 */

const KompetisiCD = (() => {

  /* ── STATE ─────────────────────────────────────────── */
  let _ctrl         = {};      // data kontrol_admin terkini
  let _callbacks    = {};      // { onStartDone, onFinished, onTick }
  let _startTimer   = null;    // interval countdown 10→0
  let _finishTimer  = null;    // interval countdown menuju jam_selesai
  let _startDone    = false;   // sudah lewati countdown awal
  let _isFinished   = false;   // kompetisi sudah selesai
  let _overlayEl    = null;    // DOM overlay countdown awal
  let _finBarEl     = null;    // DOM bar countdown selesai

  /* ── OVERLAY STYLES (disuntikkan sekali) ───────────── */
  function _injectStyles() {
    if (document.getElementById('kcd-styles')) return;
    const s = document.createElement('style');
    s.id = 'kcd-styles';
    s.textContent = `
/* ── KompetisiCD overlay mulai ── */
#kcd-overlay {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(0,0,0,.88);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 18px;
}
#kcd-overlay .kcd-label {
  font-family: 'Space Mono', 'DM Sans', monospace;
  color: #ffa502; font-size: 18px; letter-spacing: 2px;
  text-transform: uppercase;
}
#kcd-overlay .kcd-num {
  font-family: 'Space Mono', 'Orbitron', monospace;
  color: #fff; font-size: 96px; font-weight: 900;
  line-height: 1; text-shadow: 0 0 40px rgba(255,165,2,.7);
  transition: transform .15s;
}
#kcd-overlay .kcd-num.pulse { transform: scale(1.12); }
#kcd-overlay .kcd-sub {
  font-size: 14px; color: rgba(255,255,255,.45);
  letter-spacing: 1px;
}
/* ── KompetisiCD finish bar ── */
#kcd-finish-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  background: linear-gradient(90deg,#1a0000,#2d0000,#1a0000);
  border-bottom: 2px solid #ff4757;
  padding: 10px 20px;
  display: flex; align-items: center; justify-content: center; gap: 14px;
  font-family: 'Space Mono', monospace;
  animation: kcd-bar-slide .4s ease;
}
@keyframes kcd-bar-slide { from { transform:translateY(-100%); } to { transform:translateY(0); } }
#kcd-finish-bar .kcd-bar-icon { font-size: 20px; }
#kcd-finish-bar .kcd-bar-label { color: #ff4757; font-size: 13px; letter-spacing: 1px; }
#kcd-finish-bar .kcd-bar-time {
  font-size: 22px; font-weight: 700; color: #fff;
  font-family: 'Space Mono', 'Orbitron', monospace;
  min-width: 90px; text-align: center;
}
#kcd-finish-bar .kcd-bar-note { font-size: 12px; color: rgba(255,255,255,.45); }
/* ── Overlay SELESAI (saat jam = 0) ── */
#kcd-finish-overlay {
  position: fixed; inset: 0; z-index: 99998;
  background: rgba(0,0,0,.92);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 20px;
  animation: kcd-fadein .5s ease;
}
@keyframes kcd-fadein { from {opacity:0} to {opacity:1} }
#kcd-finish-overlay .kcd-finish-icon { font-size: 72px; }
#kcd-finish-overlay .kcd-finish-title {
  font-family: 'Space Mono','Orbitron',monospace;
  color: #ffa502; font-size: 32px; font-weight: 900;
  letter-spacing: 3px; text-transform: uppercase;
}
#kcd-finish-overlay .kcd-finish-sub {
  color: rgba(255,255,255,.55); font-size: 15px; text-align: center;
  max-width: 320px; line-height: 1.7;
}
    `;
    document.head.appendChild(s);
  }

  /* ── OVERLAY COUNTDOWN 10→0 ────────────────────────── */
  function _showStartOverlay(n) {
    if (!_overlayEl) {
      _overlayEl = document.createElement('div');
      _overlayEl.id = 'kcd-overlay';
      _overlayEl.innerHTML = `
        <div class="kcd-label">Kompetisi dimulai dalam</div>
        <div class="kcd-num" id="kcd-start-num">${n}</div>
        <div class="kcd-sub">Bersiaplah...</div>
      `;
      document.body.appendChild(_overlayEl);
    }
    _updateStartNum(n);
  }

  function _updateStartNum(n) {
    const el = document.getElementById('kcd-start-num');
    if (!el) return;
    el.textContent = n;
    el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 150);
  }

  function _removeStartOverlay() {
    if (_overlayEl) { _overlayEl.remove(); _overlayEl = null; }
  }

  /* ── COUNTDOWN AWAL 10→0 ───────────────────────────── */
  /**
   * Hitung berapa detik tersisa dari saat aktivasi.
   * activated_at = ISO string (disimpan admin saat klik Simpan ON)
   * Dari sisi klien: elapsed = now - activated_at
   * Sisa countdown = 10 - elapsed  (0 jika sudah lewat)
   */
  function _getStartRemaining(activatedAt) {
    if (!activatedAt) return 0;
    const elapsed = Math.floor((Date.now() - new Date(activatedAt).getTime()) / 1000);
    return Math.max(0, 10 - elapsed);
  }

  function _runStartCountdown(remaining, onDone) {
    _clearStartTimer();
    if (remaining <= 0) { onDone(); return; }
    _showStartOverlay(remaining);
    _startTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        _clearStartTimer();
        _updateStartNum(0);
        setTimeout(() => { _removeStartOverlay(); onDone(); }, 600);
      } else {
        _updateStartNum(remaining);
      }
    }, 1000);
  }

  function _clearStartTimer() {
    if (_startTimer) { clearInterval(_startTimer); _startTimer = null; }
  }

  /* ── FINISH BAR (countdown menuju jam selesai) ──────── */
  function _formatHMS(sec) {
    if (sec <= 0) return '00:00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function _getFinishRemaining(jamSelesai) {
    if (!jamSelesai) return null;
    const rem = Math.floor((new Date(jamSelesai).getTime() - Date.now()) / 1000);
    return rem;
  }

  function _showFinishBar(remaining) {
    if (!_finBarEl) {
      _finBarEl = document.createElement('div');
      _finBarEl.id = 'kcd-finish-bar';
      _finBarEl.innerHTML = `
        <span class="kcd-bar-icon">⏱</span>
        <span class="kcd-bar-label">WAKTU TERSISA</span>
        <span class="kcd-bar-time" id="kcd-bar-time">${_formatHMS(remaining)}</span>
        <span class="kcd-bar-note">Kerjakan sebelum waktu habis</span>
      `;
      document.body.prepend(_finBarEl);
    }
    _updateFinishBar(remaining);
  }

  function _updateFinishBar(remaining) {
    const el = document.getElementById('kcd-bar-time');
    if (!el) return;
    const txt = _formatHMS(remaining);
    el.textContent = txt;
    // 10 detik terakhir: warna merah berkedip
    if (remaining <= 10 && remaining > 0) {
      el.style.color = '#ff4757';
      el.style.animation = 'kcd-bar-slide .3s ease alternate infinite';
    }
  }

  function _removeFinishBar() {
    if (_finBarEl) { _finBarEl.remove(); _finBarEl = null; }
  }

  function _showFinishOverlay() {
    if (document.getElementById('kcd-finish-overlay')) return;
    const el = document.createElement('div');
    el.id = 'kcd-finish-overlay';
    el.innerHTML = `
      <div class="kcd-finish-icon">🏁</div>
      <div class="kcd-finish-title">Waktu Habis!</div>
      <div class="kcd-finish-sub">Kompetisi telah selesai.<br>Terima kasih sudah berpartisipasi!</div>
    `;
    document.body.appendChild(el);
  }

  function _runFinishCountdown(jamSelesai, onFinished) {
    _clearFinishTimer();
    const tick = () => {
      const rem = _getFinishRemaining(jamSelesai);
      if (rem === null) return;
      if (rem <= 0) {
        _clearFinishTimer();
        _removeFinishBar();
        if (!_isFinished) {
          _isFinished = true;
          onFinished();
        }
        return;
      }
      _showFinishBar(rem);
    };
    tick(); // langsung panggil sekali
    _finishTimer = setInterval(tick, 1000);
  }

  function _clearFinishTimer() {
    if (_finishTimer) { clearInterval(_finishTimer); _finishTimer = null; }
  }

  /* ── PUBLIC API ─────────────────────────────────────── */
  /**
   * init(ctrl, callbacks)
   *   ctrl       : object parsed dari x_01 kontrol_admin
   *   callbacks  : {
   *     onStartDone()   — dipanggil setelah countdown 10→0 selesai
   *     onFinished()    — dipanggil saat jam_selesai tercapai
   *   }
   *
   * Logika:
   *   - Jika kompetisi aktif dan masih dalam 10 detik pertama → tampilkan countdown awal
   *   - Setelah countdown awal (atau jika sudah lewat 10 detik) → onStartDone()
   *   - Jika ada jam_selesai → mulai finish countdown bar
   *   - Jika jam_selesai sudah lewat → langsung onFinished()
   */
  function init(ctrl, callbacks) {
    _injectStyles();
    _ctrl      = ctrl || {};
    _callbacks = callbacks || {};

    const isOn       = _ctrl.kompetisi === true;
    const activatedAt = _ctrl.activated_at || null;
    const jamSelesai  = _ctrl.jam_selesai  || null;
    const isFinished  = _ctrl.finished === true;

    // Reset state
    _clearStartTimer();
    _clearFinishTimer();
    _removeStartOverlay();
    _removeFinishBar();
    _isFinished  = false;
    _startDone   = false;

    if (!isOn) return; // kompetisi belum aktif, tidak ada yang dilakukan

    // Cek apakah sudah finish
    if (isFinished || (jamSelesai && _getFinishRemaining(jamSelesai) <= 0)) {
      _isFinished = true;
      if (_callbacks.onFinished) _callbacks.onFinished();
      return;
    }

    // Countdown awal 10→0
    const startRem = _getStartRemaining(activatedAt);

    const afterStartDone = () => {
      _startDone = true;
      if (_callbacks.onStartDone) _callbacks.onStartDone();
      // Setelah countdown awal selesai, jalankan finish countdown jika ada
      if (jamSelesai) {
        _runFinishCountdown(jamSelesai, () => {
          if (_callbacks.onFinished) _callbacks.onFinished();
        });
      }
    };

    if (startRem > 0) {
      _runStartCountdown(startRem, afterStartDone);
    } else {
      // Sudah lewat 10 detik sejak aktif, langsung skip
      afterStartDone();
    }
  }

  /**
   * showFinishScreen()
   * Tampilkan overlay SELESAI (untuk index.html saat waktu habis).
   */
  function showFinishScreen() {
    _removeFinishBar();
    _showFinishOverlay();
  }

  /**
   * formatHMS(sec) — utility publik jika dibutuhkan
   */
  function formatHMS(sec) { return _formatHMS(sec); }

  /**
   * getFinishRemaining(jamSelesai) — utility publik
   */
  function getFinishRemaining(jamSelesai) { return _getFinishRemaining(jamSelesai); }

  return { init, showFinishScreen, formatHMS, getFinishRemaining };

})();
