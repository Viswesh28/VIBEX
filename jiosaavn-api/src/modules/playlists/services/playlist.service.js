import {
  GetPlaylistByIdUseCase,
  GetPlaylistByLinkUseCase
} from "../use-cases/index.js";
class PlaylistService {
  getPlaylistByIdUseCase;
  getPlaylistByLinkUseCase;
  constructor() {
    this.getPlaylistByIdUseCase = new GetPlaylistByIdUseCase();
    this.getPlaylistByLinkUseCase = new GetPlaylistByLinkUseCase();
  }
  getPlaylistById = (args) => {
    return this.getPlaylistByIdUseCase.execute(args);
  };
  getPlaylistByLink = (args) => {
    return this.getPlaylistByLinkUseCase.execute(args);
  };
}
export {
  PlaylistService
};
