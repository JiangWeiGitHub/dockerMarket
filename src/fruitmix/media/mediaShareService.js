// for all operations, user should be valid, shareUUID should be validated by caller (rest router)

import { isUUID, isSHA256, complement, validateProps } from '../lib/types'
import E from '../lib/error'
import { createMediaShareDoc, updateMediaShareDoc } from './mediaShareDoc'

class MediaShareService {

  constructor(mediaData, mediaShareData) {
    this.mediaData = mediaData
    this.mediaShareData = mediaShareData
  }

  async load() {
    await this.mediaShareData.load()
  }

  findMediaShareByUUID(shareUUID) {
    if(!isUUID(shareUUID)) throw new E.EINVAL()
    let share = this.mediaShareData.findShareByUUID(shareUUID)
    if(share) return share
    else throw new E.ENOENT()
  }

  // return { digest, doc } // for compatibility
  // post should be non-null js object
  async createMediaShare(userUUID, post) {
    if(!isUUID(userUUID)) throw new E.EINVAL()
    if(typeof post !== 'object' || post === null) throw new E.EINVAL()

    validateProps(post, ['maintainers', 'viewers', 'album', 'contents'])

    let {maintainers, viewers, album, contents} = post
    // contents format and permission check
    if(!Array.isArray(contents)) throw new E.EINVAL()
    if(!contents.length) throw new E.EINVAL()
    if(!contents.every(isSHA256)) throw new E.EINVAL()
    if(!contents.every(digest => this.mediaData.mediaShareAllowed(userUUID, digest))) throw new E.EACCESS()

    // maintainers format check
    if(!Array.isArray(maintainers)) throw new E.EINVAL()
    if(!maintainers.every(isUUID))throw new  E.EINVAL()

    // viewers format check
    if(!Array.isArray(viewers)) throw new E.EINVAL()
    if(!viewers.every(isUUID)) throw new  E.EINVAL()

    // album format check
    if(typeof album !== 'object') throw new E.EINVAL()
    if(album) {
      validateProps(album, ['title'], ['text'])
      if(typeof album.title !== 'string') throw new E.EINVAL()
      if(album.hasOwnProperty('text')) {
        if(typeof album.text !== 'string') throw new E.EINVAL()
      }
    }

    let doc = createMediaShareDoc(userUUID, post)
    return await this.mediaShareData.createMediaShare(doc)
  } 

  // return { digest, doc } // for compatibility 
  // patch should be non-null js object
  async updateMediaShare(userUUID, shareUUID, patch) {
    if(!isUUID(userUUID)) throw new E.EINVAL()
    if(!isUUID(shareUUID)) throw new E.EINVAL()

    let share = this.findMediaShareByUUID(shareUUID)
    if(share.doc.author !== userUUID && share.doc.maintainers.indexOf(userUUID) === -1) throw new E.EACCESS()
    
    if(!Array.isArray(patch)) throw new E.EINVAL()
    patch.forEach(op => {
      if(typeof op !== 'object') throw new E.EINVAL()

      validateProps(op, ['path', 'operation', 'value'])

      if(complement([op.path], ['maintainers', 'viewers', 'album', 'contents']).length !== 0)
        throw new E.EINVAL()

      if(complement([op.path], ['maintainers', 'viewers', 'contents']).length === 0) {
        if(op.operation !== 'add' && op.operation !== 'delete') throw new E.EINVAL()
        if(!Array.isArray(op.value)) throw new E.EINVAL()
        if(op.path === 'contents') {
          if(!op.value.every(isSHA256)) throw new E.EINVAL()
          if(!op.value.every(digest => this.mediaData.mediaShareAllowed(userUUID, digest))) throw new E.EACCESS()
        }
        else {
          if(!op.value.every(isUUID)) throw new E.EINVAL()
        }
      }
      else {
        if(op.operation !== 'update') throw new E.EINVAL()
        if(typeof op.value !== 'object') throw new E.EINVAL()
        if(op.value) {
          validateProps(op.value, ['title'], ['text'])
          if(typeof op.value.title !== 'string') throw new E.EINVAL()
          if(op.value.hasOwnProperty('text')) {
            if(typeof op.value.text !== 'string') throw new E.EINVAL()
          }
        }
      }
    })

    let newDoc = updateMediaShareDoc(userUUID, share.doc, patch)
    return await this.mediaShareData.updateMediaShare(newDoc)
  } 

  // return undefined, never fail, idempotent
  async deleteMediaShare(userUUID, shareUUID) {
    if(!isUUID(userUUID)) throw new E.EINVAL()
    if(!isUUID(shareUUID)) throw new E.EINVAL()

    let share = this.findMediaShareByUUID(shareUUID)
    if(share.doc.author !== userUUID) throw new E.EACCESS()

    await this.mediaShareData.deleteMediaShare(shareUUID)
  }

  async getUserMediaShares(userUUID) {
    if(!isUUID(userUUID)) throw new E.EINVAL()
    let shares = await this.mediaShareData.getUserMediaShares(userUUID)
    let shares_1 = []
    shares.forEach(share => {
      let item = Object.assign({}, share)
      item.readable = (userUUID === share.doc.author) || share.userAuthorizedToRead(userUUID)
      item.writeable = (userUUID === share.doc.author) || share.userAuthorizedToWrite(userUUID)
      shares_1.push(item)
    })
    return shares_1
  }

  register(ipc) {

    ipc.register('getUserMediaShares', (args, callback) => 
      this.getUserMediaShares(args.userUUID).asCallback(callback))
    
    ipc.register('createMediaShare', (args, callback) => 
      this.createMediaShare(args.userUUID, args.props).asCallback(callback))

    ipc.register('updateMediaShare', (args, callback) => 
      this.updateMediaShare(args.userUUID, args.shareUUID, args.props).asCallback(callback))

    ipc.register('deleteMediaShare', (args, callback) => 
      this.deleteMediaShare(args.userUUID, args.shareUUID).asCallback(callback))
  }
}

const createMediaShareService = (mediaData, mediaShareData) => { 
  return new MediaShareService(mediaData, mediaShareData)
}

export { createMediaShareService }

