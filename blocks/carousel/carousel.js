import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';
import createSlider from '../../scripts/slider.js';

function setCarouselItems(number) {
  document.querySelector('.carousel > ul')?.style.setProperty('--items-per-view', number);
}

export default function decorate(block) {
  let i = 0;
  setCarouselItems(2);
  const slider = document.createElement('ul');
  const leftContent = document.createElement('div');

  // Find the first row index that should be a carousel item
  let carouselStartIndex = -1;
  [...block.children].forEach((row, index) => {
    if (row.children.length === 4 && carouselStartIndex === -1) {
      carouselStartIndex = index;
    }
  });

  if (carouselStartIndex === -1) {
    carouselStartIndex = 4;
  }

  [...block.children].forEach((row) => {
    if (i >= carouselStartIndex) {
      const li = document.createElement('li');
      const styleDiv = row.children[2];
      const styleParagraph = styleDiv?.querySelector('p');
      const cardStyle = styleParagraph?.textContent?.trim() || 'default';
      if (cardStyle && cardStyle !== 'default') {
        li.className = cardStyle;
      }

      const ctaDiv = row.children[3];
      const ctaParagraph = ctaDiv?.querySelector('p');
      const ctaStyle = ctaParagraph?.textContent?.trim() || 'default';

      moveInstrumentation(row, li);
      while (row.firstElementChild) li.append(row.firstElementChild);

      [...li.children].forEach((div, index) => {
        if (index === 0) {
          div.className = 'cards-card-image';
        } else if (index === 1) {
          div.className = 'cards-card-body';
        } else if (index === 2) {
          div.className = 'cards-config';
          const p = div.querySelector('p');
          if (p) {
            p.style.display = 'none';
          }
        } else if (index === 3) {
          div.className = 'cards-config';
          const p = div.querySelector('p');
          if (p) {
            p.style.display = 'none';
          }
        } else {
          div.className = 'cards-card-body';
        }
      });

      const buttonContainers = li.querySelectorAll('p.button-container');
      buttonContainers.forEach((buttonContainer) => {
        buttonContainer.classList.remove('default', 'cta-button', 'cta-button-secondary', 'cta-button-dark', 'cta-default');
        buttonContainer.classList.add(ctaStyle);
      });

      slider.append(li);
    } else {
      const hasImage = row.querySelector('img') || row.querySelector('picture');
      if (!hasImage) {
        if (row.firstElementChild?.firstElementChild) {
          leftContent.append(row.firstElementChild.firstElementChild);
        }
        if (row.firstElementChild) {
          const first = row.firstElementChild.firstElementChild;
          if (first) leftContent.append(first);
        }
        leftContent.className = 'default-content-wrapper';
      }
    }
    i += 1;
  });

  slider.querySelectorAll('picture > img').forEach((img) => {
    const optimizedPic = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
    moveInstrumentation(img, optimizedPic.querySelector('img'));
    img.closest('picture').replaceWith(optimizedPic);
  });

  const base = parseInt(block?.dataset?.headingLevel, 10);
  const ariaLevel = Number.isFinite(base) ? Math.min(Math.max(base, 1) + 1, 6) : 3;
  slider.querySelectorAll('h4,h5,h6').forEach((node) => {
    node.setAttribute('role', 'heading');
    node.setAttribute('aria-level', String(ariaLevel));
  });

  block.textContent = '';
  block.parentNode.parentNode.prepend(leftContent);
  block.append(slider);
  createSlider(block);
}
