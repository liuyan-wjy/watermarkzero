function getViewportBucket() {
    if (typeof window === 'undefined') return 'unknown';
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
}

function normalizePayload(payload = {}) {
    const normalized = {
        ...payload,
        page_path: typeof window !== 'undefined' ? window.location.pathname : '',
        page_title: typeof document !== 'undefined' ? document.title : '',
        viewport_bucket: getViewportBucket()
    };

    return Object.fromEntries(
        Object.entries(normalized).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
}

export function trackEvent(eventName, payload = {}) {
    if (typeof window === 'undefined') return;

    const normalizedPayload = normalizePayload(payload);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
        event: eventName,
        ...normalizedPayload
    });

    try {
        if (typeof window.gtag === 'function') {
            window.gtag('event', eventName, normalizedPayload);
        }

        if (window.zaraz?.track) {
            window.zaraz.track(eventName, normalizedPayload);
        }

        if (typeof window.plausible === 'function') {
            window.plausible(eventName, { props: normalizedPayload });
        }

        if (window.umami?.track) {
            window.umami.track(eventName, normalizedPayload);
        }
    } catch (error) {
        console.warn('analytics dispatch failed', error);
    }

    if (window.__GEMINI_DEBUG_TRACKING__) {
        console.debug('[analytics]', eventName, normalizedPayload);
    }
}

export function summarizeFormats(files = []) {
    const formats = new Set();

    files.forEach((file) => {
        if (typeof file?.type === 'string' && file.type.length > 0) {
            formats.add(file.type.replace('image/', ''));
            return;
        }

        if (typeof file?.name === 'string' && file.name.includes('.')) {
            formats.add(file.name.split('.').pop().toLowerCase());
        }
    });

    return Array.from(formats).sort().join(',');
}
