import { BadRequestException } from '@nestjs/common';

const YOUTUBE_ID = /^[\w-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

/**
 * Normaliza a URL do vídeo de vendas do livro (YouTube ou Vimeo).
 * Retorna `null` quando vazio (remove o vídeo) e lança BadRequest se não for um link suportado.
 */
export function normalizeVideoUrl(raw: string | null | undefined): string | null {
    const value = (raw ?? '').trim();
    if (!value) return null;

    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
        throw new BadRequestException('Link de vídeo inválido. Use um link do YouTube ou Vimeo.');
    }

    const host = url.hostname.replace(/^(www|m)\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be' && YOUTUBE_ID.test(parts[0] ?? '')) {
        return `https://www.youtube.com/watch?v=${parts[0]}`;
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        const id =
            parts[0] === 'watch' ? url.searchParams.get('v') :
            ['embed', 'shorts', 'live', 'v'].includes(parts[0]) ? parts[1] : null;
        if (id && YOUTUBE_ID.test(id)) return `https://www.youtube.com/watch?v=${id}`;
    }

    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const id = parts.find(p => VIMEO_ID.test(p));
        if (id) return `https://vimeo.com/${id}`;
    }

    throw new BadRequestException('Link de vídeo inválido. Use um link do YouTube ou Vimeo.');
}
