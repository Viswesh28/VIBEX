import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createPlaylistPayload } from '../../../playlists/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class GetPlaylistByIdUseCase {
    constructor() { }
    async execute({ id, limit, page }) {
        const { data } = await useFetch({
            endpoint: Endpoints.playlists.id,
            params: {
                listid: id,
                n: limit,
                p: page
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
