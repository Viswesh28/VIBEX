import { PlaylistModel } from '../../../playlists/models/index.js';
import { GetPlaylistByLinkUseCase } from '../../../playlists/use-cases/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('GetAlbumByLink', () => {
    let getPlaylistByLinkUseCase;
    beforeAll(() => {
        getPlaylistByLinkUseCase = new GetPlaylistByLinkUseCase();
    });
    it('should get playlist by id', async () => {
        const playlist = await getPlaylistByLinkUseCase.execute({
            token: 'AMoxtXyKHoU_',
            page: 1,
            limit: 5
        });
        expect(() => PlaylistModel.parse(playlist)).not.toThrow();
    });
});
