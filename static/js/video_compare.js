Number.prototype.clamp = function (min, max) {
  return Math.min(Math.max(this, min), max);
};

// Build the elapsed / separator / duration spans once, so the frame loop only
// writes text nodes instead of re-parsing HTML every tick.
function buildTimeLabel(el) {
  if (!el) return null;
  function span(cls, text) {
    var s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    el.appendChild(s);
    return s;
  }
  el.textContent = "";
  var elapsed = span("vc-elapsed", "0:00");
  span("vc-sep", "/");
  var duration = span("vc-duration", "0:00");
  return { elapsed: elapsed, duration: duration };
}

// Set up one comparison widget given a container id and its two video ids.
function initVideoCompare(containerId, leftVideoId, rightVideoId) {
  var container = document.getElementById(containerId);
  var canvas = document.getElementById(containerId + "_canvas");
  var vidLeft = document.getElementById(leftVideoId);
  var vidRight = document.getElementById(rightVideoId);
  // A case may be commented out of the page; skip it rather than throwing.
  if (!container || !canvas || !vidLeft || !vidRight) return;
  var ctx = canvas.getContext("2d");

  var position = 0.1;   // divider position in [0, 1]; 0 = leftmost

  function sizeCanvas() {
    // Both videos are assumed to share the same resolution.
    canvas.width = vidLeft.videoWidth;
    canvas.height = vidLeft.videoHeight;
  }

  function trackLocation(e) {
    var bcr = canvas.getBoundingClientRect();
    position = ((e.pageX - bcr.x) / bcr.width).clamp(0, 1);
  }
  function trackLocationTouch(e) {
    var bcr = canvas.getBoundingClientRect();
    position = ((e.touches[0].pageX - bcr.x) / bcr.width).clamp(0, 1);
  }
  // Only move the divider while the mouse button is held down (click-and-drag),
  // not on a bare hover.
  var dragging = false;
  canvas.addEventListener("mousedown", function (e) {
    dragging = true;
    trackLocation(e);   // jump to the click position immediately
  }, false);
  window.addEventListener("mousemove", function (e) {
    if (dragging) trackLocation(e);
  }, false);
  window.addEventListener("mouseup", function () {
    dragging = false;
  }, false);
  canvas.addEventListener("touchstart", trackLocationTouch, false);
  canvas.addEventListener("touchmove", trackLocationTouch, false);

  function drawLoop() {
    var w = canvas.width;
    var h = canvas.height;
    var split = (w * position).clamp(0, w);

    // Left video: draw the portion to the left of the divider.
    ctx.drawImage(vidLeft, 0, 0, split, h, 0, 0, split, h);
    // Right video: draw the portion to the right of the divider.
    ctx.drawImage(vidRight, split, 0, w - split, h, split, 0, w - split, h);

    // ---- Divider line + arrow handle (matches PhysTwin styling) ----
    var arrowLength = 0.09 * h;
    var arrowheadWidth = 0.025 * h;
    var arrowheadLength = 0.04 * h;
    var arrowPosY = h / 10;
    var arrowWidth = 0.007 * h;
    var currX = w * position;

    // Circle behind the arrow
    ctx.beginPath();
    ctx.arc(currX, arrowPosY, arrowLength * 0.7, 0, Math.PI * 2, false);
    ctx.fillStyle = "#FFD79340";
    ctx.fill();

    // Vertical divider line
    ctx.beginPath();
    ctx.moveTo(currX, 0);
    ctx.lineTo(currX, h);
    ctx.closePath();
    ctx.strokeStyle = "#444444";
    ctx.lineWidth = 5;
    ctx.stroke();

    // Double-headed arrow
    ctx.beginPath();
    ctx.moveTo(currX, arrowPosY - arrowWidth / 2);
    ctx.lineTo(currX + arrowLength / 2 - arrowheadLength / 2, arrowPosY - arrowWidth / 2);
    ctx.lineTo(currX + arrowLength / 2 - arrowheadLength / 2, arrowPosY - arrowheadWidth / 2);
    ctx.lineTo(currX + arrowLength / 2, arrowPosY);
    ctx.lineTo(currX + arrowLength / 2 - arrowheadLength / 2, arrowPosY + arrowheadWidth / 2);
    ctx.lineTo(currX + arrowLength / 2 - arrowheadLength / 2, arrowPosY + arrowWidth / 2);
    ctx.lineTo(currX - arrowLength / 2 + arrowheadLength / 2, arrowPosY + arrowWidth / 2);
    ctx.lineTo(currX - arrowLength / 2 + arrowheadLength / 2, arrowPosY + arrowheadWidth / 2);
    ctx.lineTo(currX - arrowLength / 2, arrowPosY);
    ctx.lineTo(currX - arrowLength / 2 + arrowheadLength / 2, arrowPosY - arrowheadWidth / 2);
    ctx.lineTo(currX - arrowLength / 2 + arrowheadLength / 2, arrowPosY - arrowWidth / 2);
    ctx.lineTo(currX, arrowPosY - arrowWidth / 2);
    ctx.closePath();
    ctx.fillStyle = "#444444";
    ctx.fill();

    requestAnimationFrame(drawLoop);
  }

  // ---- Auto-replay with a pause on the final frame ----
  // Instead of seamless looping, play once, hold the last frame for a moment
  // so the final deformation can be inspected, then restart.
  var REPLAY_PAUSE_MS = 2000;
  var replayTimer = null;

  function clearReplayTimer() {
    if (replayTimer !== null) {
      clearTimeout(replayTimer);
      replayTimer = null;
    }
  }

  // play() rejects when autoplay is blocked; the control strip still works.
  function playBoth() {
    var a = vidLeft.play();
    var b = vidRight.play();
    if (a && a.catch) a.catch(function () {});
    if (b && b.catch) b.catch(function () {});
  }

  function restartBoth() {
    vidLeft.currentTime = 0;
    vidRight.currentTime = 0;
    playBoth();
  }

  function setupAutoReplay() {
    // Disable native looping so the "ended" event fires.
    vidLeft.loop = false;
    vidRight.loop = false;

    vidLeft.addEventListener("ended", function () {
      vidRight.pause();   // freeze the right clip on its last frame too
      clearReplayTimer();
      replayTimer = setTimeout(function () {
        replayTimer = null;
        restartBoth();
      }, REPLAY_PAUSE_MS);
    });
  }

  // ---- Custom playback controls (play/pause + seek bar) ----
  // The two source videos are hidden, so the browser's native controls can't
  // be shown. Instead we drive both clips from a small control strip and treat
  // the left video as the timeline master.
  function setupControls() {
    var playBtn = document.getElementById(containerId + "_playpause");
    var seek = document.getElementById(containerId + "_seek");
    var timeLabel = document.getElementById(containerId + "_time");
    if (!playBtn || !seek) return;

    var scrubbing = false;

    function fmt(t) {
      if (!isFinite(t)) t = 0;
      var m = Math.floor(t / 60);
      var s = Math.floor(t % 60);
      return m + ":" + (s < 10 ? "0" : "") + s;
    }

    function updateBtn() {
      playBtn.classList.toggle("is-playing", !vidLeft.paused);
      playBtn.setAttribute("aria-label", vidLeft.paused ? "Play" : "Pause");
    }

    playBtn.addEventListener("click", function () {
      clearReplayTimer();   // cancel any pending auto-replay
      if (vidLeft.paused) {
        // If we're sitting on the final frame, restart from the beginning.
        if (vidLeft.ended) {
          restartBoth();
        } else {
          vidLeft.play();
          vidRight.play();
        }
      } else {
        vidLeft.pause();
        vidRight.pause();
      }
    });
    vidLeft.addEventListener("play", updateBtn);
    vidLeft.addEventListener("pause", updateBtn);
    vidLeft.addEventListener("ended", updateBtn);   // show ▶ during the end pause

    // Scrub both videos together while dragging the seek bar.
    seek.addEventListener("input", function () {
      scrubbing = true;
      clearReplayTimer();   // scrubbing cancels any pending auto-replay
      var t = (seek.value / 1000) * (vidLeft.duration || 0);
      vidLeft.currentTime = t;
      vidRight.currentTime = t;
      seek.style.setProperty("--vc-progress", (seek.value / 10).toFixed(2) + "%");
    });
    seek.addEventListener("change", function () {
      scrubbing = false;
    });

    // Reflect playback position on the seek bar and time label each frame.
    var parts = buildTimeLabel(timeLabel);
    function tick() {
      if (vidLeft.duration) {
        var pct = (vidLeft.currentTime / vidLeft.duration) * 100;
        if (!scrubbing) seek.value = pct * 10;
        seek.style.setProperty("--vc-progress", pct.toFixed(2) + "%");
        if (parts) {
          parts.elapsed.textContent = fmt(vidLeft.currentTime);
          parts.duration.textContent = fmt(vidLeft.duration);
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    updateBtn();
  }

  // Keep the two clips in sync and start the draw loop once both are ready.
  var started = false;
  function start() {
    if (started) return;
    if (vidLeft.readyState > 2 && vidRight.readyState > 2) {
      started = true;
      sizeCanvas();
      setupAutoReplay();
      restartBoth();   // from frame 0, so the two clips stay in step
      setupControls();
      requestAnimationFrame(drawLoop);
    }
  }
  // loadeddata fires at readyState 2 but start() needs >2, so retry each step.
  ["loadeddata", "canplay", "canplaythrough", "playing"].forEach(function (ev) {
    vidLeft.addEventListener(ev, start);
    vidRight.addEventListener(ev, start);
  });

  // ---- Lazy loading ----
  // The videos carry preload="none", so nothing is fetched until the widget
  // comes near the viewport. Until then the canvas shows the poster frame.
  // Off-screen widgets are paused so they stop costing decode time.
  if (vidLeft.poster) {
    canvas.style.backgroundImage = 'url("' + vidLeft.poster + '")';
  }

  var loadRequested = false;
  var autoPaused = false;

  function enter() {
    if (!loadRequested) {
      loadRequested = true;
      // Hidden zero-sized clips only get metadata from preload="auto";
      // play() is what actually pulls the data.
      vidLeft.preload = "auto";
      vidRight.preload = "auto";
      vidLeft.load();
      vidRight.load();
      playBoth();
      start();
      return;
    }
    if (started && autoPaused) {
      autoPaused = false;
      // Leaving mid-replay-pause parks the clip on its last frame.
      if (vidLeft.ended) {
        restartBoth();
      } else {
        playBoth();
      }
    }
  }

  function leave() {
    if (!started) return;
    // Pause only what we started; a clip the reader paused by hand stays paused.
    if (!vidLeft.paused || replayTimer !== null) {
      autoPaused = true;
      clearReplayTimer();
      vidLeft.pause();
      vidRight.pause();
    }
  }

  var MARGIN = 300;   // start loading this many px before the widget scrolls in

  function nearViewport() {
    var r = container.getBoundingClientRect();
    return r.bottom > -MARGIN && r.top < (window.innerHeight || 0) + MARGIN;
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.isIntersecting ? enter() : leave(); });
    }, { rootMargin: MARGIN + "px 0px" });
    io.observe(container);
    // Cover the case where the widget is already in view at load.
    if (nearViewport()) enter();
  } else {
    enter();   // no observer support: fall back to loading right away
  }
}

// Planning clips: one video, no canvas, otherwise the same behaviour.
function initPlanClip(mediaId) {
  var media = document.getElementById(mediaId);
  var video = document.getElementById(mediaId + "_video");
  if (!media || !video) return;

  var MARGIN = 300;
  var REPLAY_PAUSE_MS = 2000;
  var loadRequested = false;
  var shouldPlay = false;
  var userPaused = false;
  var replayTimer = null;

  function clearReplayTimer() {
    if (replayTimer !== null) {
      clearTimeout(replayTimer);
      replayTimer = null;
    }
  }

  function play() {
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  function restart() {
    video.currentTime = 0;
    play();
  }

  // Native looping gives no pause on the last frame, so drive replay by hand.
  video.loop = false;
  video.addEventListener("ended", function () {
    clearReplayTimer();
    replayTimer = setTimeout(function () {
      replayTimer = null;
      if (shouldPlay && !userPaused) restart();
    }, REPLAY_PAUSE_MS);
  });

  var playBtn = document.getElementById(mediaId + "_playpause");
  var seek = document.getElementById(mediaId + "_seek");
  var timeLabel = document.getElementById(mediaId + "_time");
  var scrubbing = false;

  function fmt(t) {
    if (!isFinite(t)) t = 0;
    var m = Math.floor(t / 60);
    var s = Math.floor(t % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function updateBtn() {
    if (!playBtn) return;
    playBtn.classList.toggle("is-playing", !video.paused);
    playBtn.setAttribute("aria-label", video.paused ? "Play" : "Pause");
  }

  if (playBtn && seek) {
    playBtn.addEventListener("click", function () {
      clearReplayTimer();
      if (video.paused) {
        userPaused = false;
        if (video.ended) restart(); else play();
      } else {
        userPaused = true;
        video.pause();
      }
    });
    seek.addEventListener("input", function () {
      scrubbing = true;
      clearReplayTimer();
      video.currentTime = (seek.value / 1000) * (video.duration || 0);
      seek.style.setProperty("--vc-progress", (seek.value / 10).toFixed(2) + "%");
    });
    seek.addEventListener("change", function () { scrubbing = false; });

    var parts = buildTimeLabel(timeLabel);
    (function tick() {
      if (video.duration) {
        var pct = (video.currentTime / video.duration) * 100;
        if (!scrubbing) seek.value = pct * 10;
        seek.style.setProperty("--vc-progress", pct.toFixed(2) + "%");
        if (parts) {
          parts.elapsed.textContent = fmt(video.currentTime);
          parts.duration.textContent = fmt(video.duration);
        }
      }
      requestAnimationFrame(tick);
    })();
  }
  ["play", "pause", "ended"].forEach(function (ev) {
    video.addEventListener(ev, updateBtn);
  });
  updateBtn();

  function enter() {
    shouldPlay = true;
    if (!loadRequested) {
      loadRequested = true;
      video.preload = "auto";
      video.load();
    }
    if (video.paused && !userPaused && replayTimer === null) {
      if (video.ended) restart(); else play();
    }
  }

  function leave() {
    shouldPlay = false;
    clearReplayTimer();
    if (!video.paused) video.pause();
  }

  // A clip scrolled past while still buffering would otherwise never start.
  ["loadeddata", "canplay", "canplaythrough"].forEach(function (ev) {
    video.addEventListener(ev, function () {
      if (shouldPlay && !userPaused && video.paused && replayTimer === null) play();
    });
  });

  function nearViewport() {
    var r = media.getBoundingClientRect();
    return r.bottom > -MARGIN && r.top < (window.innerHeight || 0) + MARGIN;
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.isIntersecting ? enter() : leave(); });
    }, { rootMargin: MARGIN + "px 0px" }).observe(media);
    if (nearViewport()) enter();
  } else {
    enter();
  }
}

window.addEventListener("load", function () {
  ["plan_rope", "plan_cloth"].forEach(initPlanClip);

  // Experiment 1: Confidence Map Visualization (left = rgb, right = conf).
  // Experiment 2: Confidence-Guided Material Identification (left = rgb, right = overlay).
  ["single_clift_cloth", "double_clift_cloth", "single_clift_rope", "single_push_rope", "double_stretch_bear_1", "double_squeeze_plastic",
   "kuka_rope", "kuka_cloth", "kuka_bear"].forEach(function (caseName) {
    ["cam2", "cam0", "cam1"].forEach(function (cam) {
      var id = "compare_" + caseName + "_" + cam;
      initVideoCompare(id, id + "_left", id + "_right");
    });
  });
});
