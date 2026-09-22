import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createSongPayload } from '../../../songs/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class GetArtistSongsUseCase {
    constructor() { }
    async execute({ artistId, page, sortOrder, sortBy }) {
        const { data } = await useFetch({
            endpoint: Endpoints.artists.songs,
            params: {
                artistId,
                page,
                sort_order: sortOrder,
                category: sortBy
            }
        });
        if (!data)
            throw new HTTPException(404, { message: 'artist songs not found' });
        return {
            total: data.topSongs.total,
            songs: data.topSongs.songs.map((song) => createSongPayload(song))
        };
    }
}
