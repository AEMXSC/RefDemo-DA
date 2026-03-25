import {
  div, a, span, img, video, source, button,
  h2,
} from '../../scripts/dom-helpers.js';

const SAMPLE_VIDEO = 'https://v.ftcdn.net/02/35/97/40/700_F_235974059_oVftmgBBJ32tgsDvxRdMdtpQDMfNFWEt_ST.mp4';

function createVideoPlayer(videoSrc) {
  const pauseIcon = `${window.hlx.codeBasePath}/icons/video-pause.svg`;
  const playIcon = `${window.hlx.codeBasePath}/icons/video-play.svg`;

  /* eslint-disable function-paren-newline */
  const videoPlayer = div({ class: 'video-container' },
    div({ class: 'video-play', id: 'playButton', tabindex: 0 },
      button({ class: 'video-play-btn', 'aria-label': 'video-play-btn' }, img({
        class: 'play-icon controls', src: playIcon, width: 28, height: 28, alt: 'play animation',
      })),
    ),
    div({ class: 'video-pause inactive', id: 'pauseButton' },
      button({ class: 'video-pause-btn', 'aria-label': 'video-pause-btn' }, img({
        class: 'pause-icon controls', src: pauseIcon, width: 28, height: 28, alt: 'pause animation',
      })),
    ),
    video({ id: 'videoPlayer' },
      source({ src: videoSrc, type: 'video/mp4' }, 'Your browser does not support the video tag.'),
    ),
  );

  const videoEl = videoPlayer.querySelector('video');
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.loop = true;

  return videoPlayer;
}

function createBackgroundImage(imgSrc, imgAlt) {
  const imgBackground = div({ class: 'background-image' },
    img({ class: 'teaser-background', src: imgSrc, alt: imgAlt }),
  );
  if (!imgSrc) imgBackground.classList.add('inactive');
  return imgBackground;
}

function observeVideo(block) {
  const videoPlayerEl = block.querySelector('video');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        videoPlayerEl.pause();
        videoPlayerEl.dataset.state = 'pause';
        const playButton = document.getElementById('playButton');
        const pauseButton = document.getElementById('pauseButton');
        if (playButton && pauseButton) {
          playButton.classList.remove('inactive');
          playButton.setAttribute('tabindex', 0);
          pauseButton.classList.add('inactive');
          pauseButton.removeAttribute('tabindex');
        }
      }
    });
  }, { threshold: 0.5 });
  observer.observe(videoPlayerEl);
}

function attachListeners() {
  const videoPlayer = document.getElementById('videoPlayer');
  const playButton = document.getElementById('playButton');
  const pauseButton = document.getElementById('pauseButton');

  ['click', 'keydown'].forEach((eventType) => {
    playButton.addEventListener(eventType, (event) => {
      if (eventType === 'keydown' && event.key !== 'Enter') return;
      playButton.classList.add('inactive');
      playButton.removeAttribute('tabindex');
      pauseButton.classList.remove('inactive');
      pauseButton.setAttribute('tabindex', 0);
      videoPlayer.autoplay = true;
      videoPlayer.dataset.state = 'play';
      videoPlayer.play();
    });
  });

  ['click', 'keydown'].forEach((eventType) => {
    pauseButton.addEventListener(eventType, (event) => {
      if (eventType === 'keydown' && event.key !== 'Enter') return;
      playButton.classList.remove('inactive');
      playButton.setAttribute('tabindex', 0);
      pauseButton.classList.add('inactive');
      pauseButton.removeAttribute('tabindex');
      videoPlayer.autoplay = false;
      videoPlayer.dataset.state = 'pause';
      videoPlayer.pause();
    });
  });
}

export default function decorate(block) {
  const rows = [...block.children];
  const getCell = (i) => rows[i]?.querySelector(':scope > div');

  const blurbCell = getCell(0);
  const styleCell = getCell(1);
  const videoCell = getCell(2);
  const imageCell = getCell(3);
  const buttonCell = getCell(4);

  const blurbP = blurbCell?.querySelector('p');
  const teaserBlurb = blurbP ? blurbP.innerHTML : (blurbCell?.textContent?.trim() || 'Title');

  const teaserStyle = styleCell?.textContent?.trim().toLowerCase() || '';

  const videoLink = videoCell?.querySelector('a');
  const videoUrl = videoLink?.href || videoCell?.textContent?.trim() || '';

  const imgEl = imageCell?.querySelector('img');
  const imgSrc = imgEl?.getAttribute('src') || '';
  const imgAlt = imgEl?.getAttribute('alt') || '';

  const buttonText = buttonCell?.textContent?.trim() || 'Button';

  const isVideo = teaserStyle === 'video';
  const videoReference = isVideo && videoUrl ? videoUrl : SAMPLE_VIDEO;

  const swooshFirst = `${window.hlx.codeBasePath}/icons/teaser_innerswoosh.svg`;
  const swooshSecond = `${window.hlx.codeBasePath}/icons/teaser_outerswoosh.svg`;

  /* eslint-disable function-paren-newline */
  const teaser = div({ class: 'teaser-container' },
    isVideo ? createVideoPlayer(videoReference) : createBackgroundImage(imgSrc, imgAlt),
    div({ class: 'teaser-swoosh-wrapper' },
      div({ class: 'swoosh-bg' }),
      div({ class: 'swoosh-layers' },
        img({ class: 'swoosh first', src: swooshFirst, alt: 'background swoosh first' }),
        img({ class: 'swoosh second', src: swooshSecond, alt: 'background swoosh second' }),
      ),
      div({ class: 'teaser-title-wrapper' },
        h2({ class: 'teaser-title' }),
        div({ class: 'button-container' },
          a({ id: 'button', href: '', class: 'button dark-bg' },
            span({ class: 'button-text' }, buttonText),
          ),
        ),
      ),
    ),
  );

  teaser.querySelector('.teaser-title').innerHTML = teaserBlurb;
  block.innerHTML = '';
  block.appendChild(teaser);

  if (isVideo) {
    observeVideo(block);
    attachListeners();
  }
}
