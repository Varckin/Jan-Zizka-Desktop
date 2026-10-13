(function () {
    'use strict';

    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    function createStarfall() {
        if (document.querySelector('.starfall-bg')) return;

        const container = document.createElement('div');
        container.className = 'starfall-bg';
        container.setAttribute('aria-hidden', 'true');

        const twinkleCount = Math.min(
            120,
            Math.max(45, Math.floor((window.innerWidth * window.innerHeight) / 22000))
        );

        for (let i = 0; i < twinkleCount; i++) {
            const star = document.createElement('span');
            star.className = 'sf-star';

            const size = rand(1, 2.4);
            star.style.width = size.toFixed(2) + 'px';
            star.style.height = size.toFixed(2) + 'px';
            star.style.left = rand(0, 100).toFixed(2) + '%';
            star.style.top = rand(0, 100).toFixed(2) + '%';

            const duration = rand(2.6, 6.2);
            star.style.animationDuration = duration.toFixed(2) + 's';
            star.style.animationDelay = (-rand(0, duration)).toFixed(2) + 's';

            const tint = Math.random();
            if (tint < 0.12) {
                star.style.background = '#c8d8ff';
                star.style.boxShadow = '0 0 5px rgba(180, 210, 255, 0.75)';
            } else if (tint < 0.22) {
                star.style.background = '#ffe9c8';
                star.style.boxShadow = '0 0 5px rgba(255, 220, 170, 0.7)';
            } else if (tint < 0.30) {
                star.style.background = '#e8d8ff';
                star.style.boxShadow = '0 0 5px rgba(210, 180, 255, 0.7)';
            }

            container.appendChild(star);
        }

        const meteorCount = Math.min(
            18,
            Math.max(6, Math.floor(window.innerWidth / 130))
        );

        for (let i = 0; i < meteorCount; i++) {
            const meteor = document.createElement('span');
            meteor.className = 'sf-meteor';

            const kind = Math.random();
            if (kind < 0.15) {
                meteor.classList.add('sf-meteor--warm');
            } else if (kind < 0.55) {
                meteor.classList.add('sf-meteor--cool');
            }

            meteor.style.left = rand(25, 115).toFixed(2) + '%';
            meteor.style.top = rand(-30, 15).toFixed(2) + '%';

            const scale = rand(0.65, 1.35);
            meteor.style.width = (3 * scale).toFixed(2) + 'px';
            meteor.style.height = (3 * scale).toFixed(2) + 'px';
            meteor.style.setProperty('--sf-tail', (120 * scale).toFixed(0) + 'px');

            const duration = rand(3.8, 7.5);
            meteor.style.animationDuration = duration.toFixed(2) + 's';
            meteor.style.animationDelay = (-rand(0, duration)).toFixed(2) + 's';

            container.appendChild(meteor);
        }

        document.body.insertBefore(container, document.body.firstChild);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createStarfall);
    } else {
        createStarfall();
    }
})();
