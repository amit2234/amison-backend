const { uploadStoreMediaBuffer } = require('../../../modules/store/store.media.service');

class FrameUploadService {
    static async uploadFrameMedia(buffer, options = {}) {
        return uploadStoreMediaBuffer(buffer, options);
    }
}

module.exports = FrameUploadService;
