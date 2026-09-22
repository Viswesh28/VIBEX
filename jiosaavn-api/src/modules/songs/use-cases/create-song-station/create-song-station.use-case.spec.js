import { CreateSongStationUseCase } from '../../../songs/use-cases/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('CreateSongStation', () => {
    let createSongStationUseCase;
    beforeAll(() => {
        createSongStationUseCase = new CreateSongStationUseCase();
    });
    it('should create a song station', async () => {
        const station = await createSongStationUseCase.execute('3IoDK8qI');
        expect(station).toBeDefined();
    });
});
