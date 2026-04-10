import {
  div, span, button,
} from '../../scripts/dom-helpers.js';

const DISMISS_KEY = 'promo-banner-dismissed';

/**
 * Parses a countdown target from text like "2026-04-30T23:59:59"
 * @param {string} dateStr ISO date string
 * @returns {{ days: number, hours: number, minutes: number, seconds: number } | null}
 */
function getTimeRemaining(dateStr) {
  const total = Date.parse(dateStr) - Date.now();
  if (total <= 0) return null;
  return {
    days: Math.floor(total / (1000 * 60 * 60 * 24)),
    hours: Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / (1000 * 60)) % 60),
    seconds: Math.floor((total / 1000) % 60),
  };
}

/**
 * Builds a countdown timer element and starts the interval
 * @param {string} endDate ISO date string
 * @returns {Element}
 */
function createCountdown(endDate) {
  const countdown = div({ class: 'promo-banner-countdown', 'aria-live': 'polite', 'aria-label': 'Countdown timer' });

  function updateCountdown() {
    const t = getTimeRemaining(endDate);
    if (!t) {
      countdown.textContent = 'Offer expired';
      return;
    }
    countdown.innerHTML = '';

    const segments = [
      { value: t.days, label: 'Days' },
      { value: t.hours, label: 'Hrs' },
      { value: t.minutes, label: 'Min' },
      { value: t.seconds, label: 'Sec' },
    ];

    segments.forEach(({ value, label }) => {
      /* eslint-disable function-paren-newline */
      countdown.appendChild(
        div({ class: 'promo-banner-countdown-segment' },
          span({ class: 'promo-banner-countdown-value' }, String(value).padStart(2, '0')),
          span({ class: 'promo-banner-countdown-label' }, label),
        ),
      );
      /* eslint-enable function-paren-newline */
    });
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);
  return countdown;
}

/**
 * Creates geometric circle decorations
 * @returns {Element}
 */
function createCircles() {
  /* eslint-disable function-paren-newline */
  return div({ class: 'promo-banner-circles' },
    div({ class: 'promo-banner-circle promo-banner-circle-1' }),
    div({ class: 'promo-banner-circle promo-banner-circle-2' }),
    div({ class: 'promo-banner-circle promo-banner-circle-3' }),
  );
  /* eslint-enable function-paren-newline */
}

/**
 * Sets up IntersectionObserver for entrance animation
 * @param {Element} block
 */
function observeEntrance(block) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        block.classList.add('promo-banner-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  observer.observe(block);
}

/**
 * Loads and decorates the promo-banner block.
 *
 * Authored content structure (rows):
 *   Row 1: Image (picture) | Text content (heading, description, CTA)
 *   Row 2: Badge text (e.g. "20% OFF")
 *   Row 3: Countdown end date (ISO 8601, e.g. "2026-04-30T23:59:59")
 *   Row 4: Theme (purple | teal | coral | dark)
 *   Row 5: Layout (split | centered | minimal)
 *
 * Block class variants can also be set via block name:
 *   promo-banner (purple, split) — using parenthetical variants
 *
 * @param {Element} block The promo-banner block element
 */
export default function decorate(block) {
  const rows = [...block.children];
  const getCell = (rowIdx, colIdx = 0) => rows[rowIdx]?.children?.[colIdx];

  // Check if dismissed
  const bannerId = block.closest('.section')?.dataset?.id || 'default';
  const dismissKey = `${DISMISS_KEY}-${bannerId}`;
  if (localStorage.getItem(dismissKey)) {
    block.remove();
    return;
  }

  // Row 1: main content — col 0 = image, col 1 = text
  const imageCol = getCell(0, 0);
  const textCol = getCell(0, 1);

  // Row 2: badge
  const badgeText = getCell(1)?.textContent?.trim() || '';

  // Row 3: countdown date
  const countdownDate = getCell(2)?.textContent?.trim() || '';

  // Row 4: theme
  const theme = getCell(3)?.textContent?.trim()?.toLowerCase() || 'purple';

  // Row 5: layout
  const layout = getCell(4)?.textContent?.trim()?.toLowerCase() || 'split';

  // Apply theme and layout classes
  block.classList.add(`promo-banner-${theme}`, `promo-banner-${layout}`);

  // Build image section
  const pictureEl = imageCol?.querySelector('picture');
  const imageWrapper = div({ class: 'promo-banner-image' });
  if (pictureEl) {
    imageWrapper.appendChild(pictureEl);
  }

  // Build text section
  const textWrapper = div({ class: 'promo-banner-content' });
  if (textCol) {
    [...textCol.children].forEach((child) => textWrapper.appendChild(child.cloneNode(true)));
  }

  // Badge
  if (badgeText) {
    const badge = div({ class: 'promo-banner-badge' }, span(badgeText));
    textWrapper.prepend(badge);
  }

  // Countdown
  if (countdownDate) {
    const countdown = createCountdown(countdownDate);
    textWrapper.appendChild(countdown);
  }

  // Close button
  const closeBtn = button({
    class: 'promo-banner-close',
    'aria-label': 'Dismiss banner',
    type: 'button',
  }, '\u00D7');
  closeBtn.addEventListener('click', () => {
    block.classList.add('promo-banner-hiding');
    block.addEventListener('animationend', () => {
      localStorage.setItem(dismissKey, 'true');
      block.remove();
    }, { once: true });
  });

  // Circles decoration
  const circles = createCircles();

  // Assemble
  block.textContent = '';

  if (layout === 'minimal') {
    // Minimal: single row bar
    const inner = div({ class: 'promo-banner-inner' });
    if (badgeText) {
      inner.appendChild(div({ class: 'promo-banner-badge' }, span(badgeText)));
    }
    // Pull just the text (no image for minimal)
    const minimalText = div({ class: 'promo-banner-minimal-text' });
    [...textWrapper.querySelectorAll('h1, h2, h3, h4, h5, h6, p, .button-wrapper')].forEach((el) => {
      if (!el.classList.contains('promo-banner-badge') && !el.classList.contains('promo-banner-countdown')) {
        minimalText.appendChild(el.cloneNode(true));
      }
    });
    inner.appendChild(minimalText);
    if (countdownDate) {
      inner.appendChild(createCountdown(countdownDate));
    }
    inner.appendChild(closeBtn);
    block.appendChild(inner);
  } else if (layout === 'centered') {
    // Centered: stacked, no image split
    block.appendChild(circles);
    block.appendChild(textWrapper);
    block.appendChild(closeBtn);
  } else {
    // Split (default): image + text side by side
    block.appendChild(circles);
    block.appendChild(imageWrapper);
    block.appendChild(textWrapper);
    block.appendChild(closeBtn);
  }

  // Entrance animation
  observeEntrance(block);
}
