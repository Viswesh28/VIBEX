import { SearchModel } from '../../../search/models/index.js';
import { SearchAllUseCase } from '../../../search/use-cases/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
describe('SearchEverything', () => {
    let searchAllUseCase;
    beforeAll(() => {
        searchAllUseCase = new SearchAllUseCase();
    });
    it('should search everything by query and return a list of results', async () => {
        const results = await searchAllUseCase.execute('imagine+dragons+bones');
        expect(() => SearchModel.parse(results)).not.toThrow();
    });
});
