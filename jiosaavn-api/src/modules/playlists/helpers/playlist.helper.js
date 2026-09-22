import { createImageLinks } from '../../../common/helpers/index.js';
import { createArtistMapPayload } from '../../artists/helpers/index.js';
import { createSongPayload } from '../../songs/helpers/index.js';
export const createPlaylistPayload = (playlist) => ({
    id: playlist.id,
    name: playlist.title,
    description: playlist.header_desc,
    type: playlist.type,
    year: playlist.year ? Number(playlist.year) : null,
    playCount: playlist.play_count ? Number(playlist.play_count) : null,
    language: playlist.language,
    explicitContent: playlist.explicit_content === '1',
    url: playlist.perma_url,
    songCount: playlist.list_count ? Number(playlist.list_count) : null,
    artists: playlist.more_info.artists?.map(createArtistMapPayload) || null,
    image: createImageLinks(playlist.image),
    songs: (playlist.list && playlist.list?.map(createSongPayload)) || null
});
