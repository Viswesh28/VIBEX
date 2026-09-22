import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createPlaylistPayload } from '../../../playlists/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class GetPlaylistByLinkUseCase {
    constructor() { }
    async execute({ token, limit, page }) {
        const { data } = await useFetch({
            endpoint: Endpoints.albums.link,
            params: {
                token,
                n: limit,
                p: page,
                type: 'playlist'
            }
        });
        if (!data)
            throw new HTTPException(404, { message: 'playlist not found' });
        const playlist = createPlaylistPayload(data);
        return {
            ...playlist,
            songCount: playlist?.songs?.length || null,
            songs: playlist?.songs?.slice(0, limit) || []
        };
    }
}
