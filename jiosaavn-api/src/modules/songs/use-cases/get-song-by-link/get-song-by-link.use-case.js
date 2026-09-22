import { Endpoints } from '../../../../common/constants/index.js';
import { useFetch } from '../../../../common/helpers/index.js';
import { createSongPayload } from '../../../songs/helpers/index.js';
import { HTTPException } from 'hono/http-exception';
export class GetSongByLinkUseCase {
    constructor() { }
    async execute(token) {
        const { data } = await useFetch({
            endpoint: Endpoints.songs.link,
            params: { token, type: 'song' }
        });
        if (!data.songs?.length)
            throw new HTTPException(404, { message: 'song not found' });
        return data.songs.map((song) => createSongPayload(song));
    }
}
