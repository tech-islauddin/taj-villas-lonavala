/**
 * Taj Villas Lonavala - Cinematic Scroll-Controlled Hero Experience
 * Maps visitor scroll progress (300vh journey) directly to the 16:9 video's currentTime.
 * Pure Vanilla JS, zero-dependency, requestAnimationFrame interpolation.
 */

document.addEventListener('DOMContentLoaded', () => {
  const video = document.getElementById('hero-video');
  const scrollContainer = document.getElementById('hero-scroll-container');
  const timelineBar = document.getElementById('timeline-bar');
  const centerCard = document.getElementById('hero-center-card');
  const bottomIndicator = document.getElementById('hero-bottom-indicator');
  const journeyHud = document.getElementById('hero-journey-hud');
  const journeyCaption = document.getElementById('journey-caption');
  const hudCurrentTime = document.getElementById('hud-current-time');
  const hudDuration = document.getElementById('hud-duration');
  const conclusionCard = document.getElementById('hero-conclusion-card');

  if (!video || !scrollContainer) {
    console.error('Taj Villas Hero: Essential elements missing from DOM');
    return;
  }

  // Ensure video is strictly configured for scroll-scrubbing
  video.pause();
  video.muted = true;
  video.playsInline = true;
  video.removeAttribute('controls');
  video.removeAttribute('autoplay');

  let videoDuration = 0;
  let targetProgress = 0;
  let currentProgress = 0;
  let isVideoReady = false;

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Wait for metadata to load before computing duration
  function onMetadataLoaded() {
    if (video.duration && !isNaN(video.duration)) {
      videoDuration = video.duration;
      isVideoReady = true;
      if (hudDuration) {
        hudDuration.textContent = formatTime(videoDuration);
      }
      try {
        if (video.currentTime === 0) {
          video.currentTime = 0.001;
        }
      } catch (e) {}
      console.log(`[Taj Villas] Video metadata loaded. Duration: ${videoDuration.toFixed(2)}s`);
      updateScrollProgress();
    }
  }

  if (video.readyState >= 1 && video.duration) {
    onMetadataLoaded();
  } else {
    video.addEventListener('loadedmetadata', onMetadataLoaded);
    video.addEventListener('canplay', () => {
      if (!isVideoReady && video.duration) {
        onMetadataLoaded();
      }
    });
  }

  // Calculate current scroll progress in the 300vh hero section (0.0 to 1.0)
  function updateScrollProgress() {
    const rect = scrollContainer.getBoundingClientRect();
    const totalTravel = scrollContainer.offsetHeight - window.innerHeight;
    
    if (totalTravel <= 0) {
      targetProgress = 0;
      return;
    }

    // rect.top is 0 when at top of hero.
    // rect.top is -totalTravel when hero has reached the end of its 300vh scroll.
    const scrolledPx = -rect.top;
    const progress = Math.max(0, Math.min(1, scrolledPx / totalTravel));
    targetProgress = progress;
  }

  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  window.addEventListener('resize', updateScrollProgress, { passive: true });

  // Update dynamic overlays based on current progress
  function updateOverlays(progress) {
    // 1. Center Hero Card (TAJ VILLAS / LONAVALA / Your Private Escape in the Hills / BOOK YOUR STAY)
    if (centerCard) {
      if (progress <= 0.05) {
        centerCard.style.opacity = '1';
        centerCard.style.transform = 'translateY(0px)';
        centerCard.style.pointerEvents = 'auto';
      } else if (progress < 0.22) {
        // Smoothly fade out as user scrolls into the video
        const fade = 1 - ((progress - 0.05) / 0.17);
        centerCard.style.opacity = Math.max(0, Math.min(1, fade)).toString();
        centerCard.style.transform = `translateY(-${(1 - fade) * 25}px)`;
        centerCard.style.pointerEvents = fade > 0.4 ? 'auto' : 'none';
      } else {
        centerCard.style.opacity = '0';
        centerCard.style.transform = 'translateY(-25px)';
        centerCard.style.pointerEvents = 'none';
      }
    }

    // 2. Bottom "SCROLL TO EXPLORE ↓" Indicator
    if (bottomIndicator) {
      if (progress <= 0.04) {
        bottomIndicator.style.opacity = '1';
      } else if (progress < 0.14) {
        const fade = 1 - ((progress - 0.04) / 0.1);
        bottomIndicator.style.opacity = Math.max(0, Math.min(1, fade)).toString();
      } else {
        bottomIndicator.style.opacity = '0';
      }
    }

    // 3. Dynamic Mid-Journey HUD (0.22 to 0.78)
    if (journeyHud) {
      if (progress >= 0.22 && progress <= 0.78) {
        journeyHud.classList.add('visible');

        // Dynamic contextual chapter captions during flight
        if (journeyCaption) {
          if (progress < 0.40) {
            journeyCaption.textContent = 'AERIAL ESTATE PERSPECTIVE';
          } else if (progress < 0.60) {
            journeyCaption.textContent = 'INFINITY POOL & VALLEY PANORAMA';
          } else {
            journeyCaption.textContent = 'CONTEMPORARY PRIVATE SANCTUARY';
          }
        }
      } else {
        journeyHud.classList.remove('visible');
      }
    }

    // 4. Conclusion Invitation Card (0.80 to 1.0)
    if (conclusionCard) {
      if (progress >= 0.80) {
        conclusionCard.classList.add('visible');
      } else {
        conclusionCard.classList.remove('visible');
      }
    }

    // 5. Hairline Gold Timeline Progress
    if (timelineBar) {
      timelineBar.style.transform = `scaleX(${progress})`;
    }
  }

  // Animation Loop: Interpolates scrub progress with requestAnimationFrame
  function scrubLoop() {
    // Smooth lerp damping for organic momentum
    const diff = targetProgress - currentProgress;
    if (Math.abs(diff) > 0.0004) {
      currentProgress += diff * 0.14;
    } else {
      currentProgress = targetProgress;
    }

    // Scrub video timeline directly via currentTime
    if (isVideoReady && videoDuration > 0) {
      // Map progress [0, 1] directly to [0, duration]
      const targetTime = Math.max(0, Math.min(videoDuration - 0.001, currentProgress * videoDuration));
      
      // Update only when frame delta is above threshold (~0.02s) to avoid unnecessary seeks
      if (Math.abs(video.currentTime - targetTime) > 0.02) {
        try {
          video.currentTime = targetTime;
        } catch (e) {
          // Ignore transient seek errors during fast scrub
        }
      }

      if (hudCurrentTime) {
        hudCurrentTime.textContent = formatTime(video.currentTime);
      }
    }

    // Update overlay visual states
    updateOverlays(currentProgress);

    requestAnimationFrame(scrubLoop);
  }

  // Start the RAF scrub loop
  requestAnimationFrame(scrubLoop);

  // Initial calculation
  updateScrollProgress();

  // Reveal animation for "Where Luxury Meets The Hills" section
  const revealElements = document.querySelectorAll('.reveal-item');
  if ('IntersectionObserver' in window && revealElements.length > 0) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      threshold: 0.12,
      rootMargin: '0px 0px -50px 0px'
    });

    revealElements.forEach(el => revealObserver.observe(el));
  } else {
    // Graceful fallback
    revealElements.forEach(el => el.classList.add('is-revealed'));
  }

  // Interactive Amenities Showcase Switcher
  const amenityRows = document.querySelectorAll('.amenity-row');
  const amenityLayers = document.querySelectorAll('.amenity-img-layer');

  if (amenityRows.length > 0 && amenityLayers.length > 0) {
    function setActiveAmenity(id) {
      amenityRows.forEach(row => {
        if (row.dataset.amenity === id) {
          row.classList.add('is-active');
        } else {
          row.classList.remove('is-active');
        }
      });

      amenityLayers.forEach(layer => {
        if (layer.dataset.amenity === id) {
          layer.classList.add('is-active');
        } else {
          layer.classList.remove('is-active');
        }
      });
    }

    amenityRows.forEach(row => {
      row.addEventListener('mouseenter', () => {
        const id = row.dataset.amenity;
        if (id) setActiveAmenity(id);
      });

      row.addEventListener('focus', () => {
        const id = row.dataset.amenity;
        if (id) setActiveAmenity(id);
      });

      row.addEventListener('click', () => {
        const id = row.dataset.amenity;
        if (id) setActiveAmenity(id);
      });
    });
  }

  // Section 9: Front-End Inquiry Form Handler & Date Constraints
  const inquiryForm = document.getElementById('booking-inquiry-form');
  const inquiryFeedback = document.getElementById('inquiry-feedback');
  const feedbackTitle = document.getElementById('feedback-title');
  const feedbackDesc = document.getElementById('feedback-desc');
  const checkinInput = document.getElementById('inq-checkin');
  const checkoutInput = document.getElementById('inq-checkout');

  // Prevent past dates in reservation inquiry
  if (checkinInput && checkoutInput) {
    const today = new Date().toISOString().split('T')[0];
    checkinInput.min = today;
    checkinInput.addEventListener('change', () => {
      if (checkinInput.value) {
        checkoutInput.min = checkinInput.value;
        if (checkoutInput.value && checkoutInput.value < checkinInput.value) {
          checkoutInput.value = checkinInput.value;
        }
      }
    });
  }

  if (inquiryForm && inquiryFeedback) {
    inquiryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const nameInput = document.getElementById('inq-name');
      const guestName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'Guest';
      
      if (feedbackTitle) {
        feedbackTitle.textContent = `Inquiry Recorded for ${guestName}`;
      }
      if (feedbackDesc) {
        feedbackDesc.textContent = `Thank you, ${guestName}. Your inquiry for TAJ VILLAS, Lonavala has been recorded. Direct reservation dispatch can be connected here upon launch.`;
      }
      
      inquiryFeedback.classList.add('is-visible');
      inquiryFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // Mobile Navigation Drawer Toggle, Backdrop & Keyboard Handling
  const hamburgerBtn = document.getElementById('nav-hamburger-btn');
  const mobileDrawer = document.getElementById('mobile-nav-drawer');
  const drawerCloseBtn = document.getElementById('mobile-drawer-close');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-item');

  function openMobileNav() {
    if (mobileDrawer && hamburgerBtn) {
      mobileDrawer.classList.add('is-open');
      hamburgerBtn.classList.add('is-active');
      hamburgerBtn.setAttribute('aria-expanded', 'true');
      mobileDrawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeMobileNav() {
    if (mobileDrawer && hamburgerBtn) {
      mobileDrawer.classList.remove('is-open');
      hamburgerBtn.classList.remove('is-active');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      mobileDrawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', () => {
      if (mobileDrawer && mobileDrawer.classList.contains('is-open')) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });
  }

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', closeMobileNav);
  }

  // Close when clicking directly on backdrop outside the inner content
  if (mobileDrawer) {
    mobileDrawer.addEventListener('click', (e) => {
      if (e.target === mobileDrawer) {
        closeMobileNav();
      }
    });
  }

  mobileNavLinks.forEach(link => {
    link.addEventListener('click', () => {
      closeMobileNav();
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileDrawer && mobileDrawer.classList.contains('is-open')) {
      closeMobileNav();
    }
  });

  // Minimal Luxury Loading State Dismissal
  function dismissPreloader() {
    const preloader = document.getElementById('luxury-preloader');
    if (preloader && !preloader.classList.contains('preloader-hidden')) {
      preloader.classList.add('preloader-hidden');
      setTimeout(() => {
        if (preloader.parentNode) preloader.parentNode.removeChild(preloader);
      }, 550);
    }
  }

  if (document.readyState === 'complete') {
    dismissPreloader();
  } else {
    window.addEventListener('load', dismissPreloader);
    // Lightweight fallback so UI becomes interactive without delay
    setTimeout(dismissPreloader, 650);
  }
});
