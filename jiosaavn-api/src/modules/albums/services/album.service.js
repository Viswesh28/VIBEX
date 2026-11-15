import { GetAlbumByIdUseCase, GetAlbumByLinkUseCase } from "../use-cases/index.js";
class AlbumService {
  getAlbumByIdUseCase;
  getAlbumByLinkUseCase;
  constructor() {
    this.getAlbumByIdUseCase = new GetAlbumByIdUseCase();
    this.getAlbumByLinkUseCase = new GetAlbumByLinkUseCase();
  }
  getAlbumById = (albumId) => {
    return this.getAlbumByIdUseCase.execute(albumId);
  };
  getAlbumByLink = (albumLink) => {
    return this.getAlbumByLinkUseCase.execute(albumLink);
  };
}
export {
  AlbumService
};
