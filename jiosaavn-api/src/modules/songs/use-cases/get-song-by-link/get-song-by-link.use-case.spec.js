import { SongModel } from '../../../songs/models/index.js';
import { GetSongByLinkUseCase } from '../../../songs/use-cases/index.js';
import { HTTPException } from 'hono/http-exception';
import { beforeAll, describe, expect, it } from 'vitest';
describe('GetSongByLink', () => {
    let getSongByLinkUseCase;
    beforeAll(() => {
        getSongByLinkUseCase = new GetSongByLinkUseCase();
    });
    it('should return a song by link', async () => {
        const song = await getSongByLinkUseCase.execute('OgwhbhtDRwM');
        expect(() => SongModel.parse(song[0])).not.toThrow();
    });
    it('should throw 404 error when song is not found', async () => {
        await expect(getSongByLinkUseCase.execute('invalid-link')).rejects.toThrow(HTTPException);
    });
});
