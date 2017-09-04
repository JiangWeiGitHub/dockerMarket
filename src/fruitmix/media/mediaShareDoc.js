import UUID from 'node-uuid'
import{isUUID, isSHA256, addUUIDArray, complement, assert, validateProps} from '../lib/types'

/**

  This file is media doc factory (no class)

  All format checking goes here. But some times its permissive.
  User permission checking is not included here.

  all functions are synchronous, no i/o operation involved.
  should throw FormatError

  a share doc

  {
M   doctype: 'mediashare',        // string, fixed
M   docversion: '1.0'             // string, fixed

M   uuid: xxxx,                   // STRING_UUID 

M   author: xxxx,                 // STRING_UUID
M   maintainers: [], // 0..n      // ARRAY_STRING_UUID
M   viewers: [], // 0..n          // ARRAY_STRING_UUID

M   album: null or object { title, text } // NULL || OBJECT
M   sticky: true or false,        // bool fixed
    
M   ctime: xxxx,                  // INT_TIME
M   mtime: xxxx,                  // INT_TIME

M   contents: [                   // ARRAY_OBJECT
      {
M       digest: xxxx
M       creator: xxxx
M       ctime: xxxx
      }
    ]
  }
**/

const unique = arr => new Set(arr).size === arr.length

const isUUIDArray = (arg) => Array.isArray(arg) && arg.every(isUUID)

const validateMediaShareDoc = (doc, users) => {
  let creators = [doc.author, ...doc.maintainers]
  let members = [doc.author, ...doc.maintainers, ...doc.viewers]

  // structure
  validateProps(doc, [
    'doctype', 'docversion', 
    'uuid', 'author', 'maintainers', 'viewers',
    'album', 'sticky',
    'ctime', 'mtime',
    'contents'
  ]) 

  // data type
  assert(doc.doctype === 'mediashare', 'invalid doctype') 
  assert(doc.docversion === '1.0', 'invalid docversion')
  assert(isUUID(doc.uuid), 'invalid doc uuid') // TODO unique check?
  assert(isUUID(doc.author), 'invalid author uuid') 

  // if author is neither local nor remote user, the share is considered invalid
  assert(users.map(u => u.uuid).includes(doc.author), 'author not found')

  // non-existent maintainer or viewer is possible
  assert(isUUIDArray(doc.maintainers), 'maintainers not uuid array')
  assert(isUUIDArray(doc.viewers), 'viewers not uuid array')

  // no member in list twice
  assert(unique(members), 'members not unique')

  assert(typeof doc.album === 'object', 'invalid album')
  if (doc.album) {
    validateProps(doc.album, ['title'], ['text'])
    assert(typeof doc.album.title === 'string', 'album title not a string')

    if (doc.album.hasOwnProperty('text')) 
      assert(typeof doc.album.text === 'string', 'album text not a string')
  }

  assert(doc.sticky === false, 'invalid sticky')

  assert(Number.isInteger(doc.ctime), 'invalid ctime')
  assert(Number.isInteger(doc.mtime), 'invalid mtime')

  doc.contents.forEach(entry => {

    validateProps(entry, ['digest', 'creator', 'ctime'])
    
    assert(isSHA256(entry.digest), 'invalid digest')
    assert(isUUID(entry.creator), 'invalid creator')
    assert(creators.includes(entry.creator), 'creator not author or maintainer')
    assert(Number.isInteger(entry.ctime), 'invalid ctime')
  })
}

// generate a mediashare doc
const createMediaShareDoc = (authorUUID, obj) => {

  let {maintainers, viewers, album, contents} = obj

  maintainers = Array.from(new Set(maintainers)).filter(maintainer => maintainer !== authorUUID)

  viewers = Array.from(new Set(viewers)).filter(viewer => viewer !== authorUUID)
  viewers = complement(viewers, maintainers)

  let time = new Date().getTime()
  contents = Array.from(new Set(contents)).map(digest => ({
    creator: authorUUID,
    digest,
    ctime: time
  }))

  return {
    doctype: 'mediashare',
    docversion: '1.0',
    uuid: UUID.v4(),
    author: authorUUID,
    maintainers,
    viewers,
    album,
    sticky: false,
    ctime: time,
    mtime: time,
    contents
  }
}

// update a mediashare doc
// each op containes:
// {
//   path: 'maintainers', 'viewers', 'albun', 'sticky', or 'contents', describes which part to be modifed
//   operation: 'add', 'delete', or 'update'. add, delete for array, update for non-array
//   value: the elements to be updated
// }
const updateMediaShareDoc = (userUUID, doc, ops) => {

  let op
  let {maintainers, viewers, album, contents} = doc

  if(userUUID === doc.author) {

    op = ops.find(op => (op.path === 'maintainers' && op.operation === 'add'))
    if(op) {
      maintainers = addUUIDArray(maintainers, op.value)

      // delete the viewer which is moved to maintainers
      viewers = complement(viewers, op.value)
    }

    op = ops.find(op => op.path === 'maintainers' && op.operation === 'delete')
    if(op) {// && Array.isArray(op.value)) {
      maintainers = complement(maintainers, op.value)

      // the contents shared by deleted maintainers should also be removed
      let deletedUser = complement(doc.maintainers, maintainers)
      deletedUser.forEach(uuid => {
        let index = contents.findIndex(item => item.creator === uuid)
        if(index !== -1) contents.splice(index, 1)
      })
    }

    op = ops.find(op => op.path === 'viewers' && op.operation === 'add')
    if(op) {// && Array.isArray(op.value))
      viewers = addUUIDArray(viewers, op.value)
      viewers = complement(viewers, maintainers) //dedupe
    }

    op = ops.find(op => op.path === 'viewers' && op.operation === 'delete')
    if(op) // && Array.isArray(op.value))
      viewers = complement(viewers, op.value)

    op = ops.find(op => op.path === 'album' && op.operation === 'update')
    if(op) {// && typeof op.value === 'object'){
      if(op.value === null) 
        album = null
      else {
        let title = op.value.title
        if(op.value.hasOwnProperty('text')) {
          let text = op.value.text
          album = {title, text}
        }
        else album = {title}
      }
    }
  }

  if(userUUID === doc.author || doc.maintainers.indexOf(userUUID) !== -1) {

    op = ops.find(op => op.path === 'contents' && op.operation === 'add')
    if(op) {
      let c = [...contents]
      let dirty = false

      op.value.forEach(digest => {
          let index = c.findIndex(x => x.digest === digest)
          if(index !== -1) return

          dirty = true
          c.push({
            creator: userUUID,
            digest,
            ctime: new Date().getTime()
          })
        })

      if(dirty) contents = c
    }

    op = ops.find(op => op.path === 'contents' && op.operation === 'delete')
    if(op) {
      let c = [...contents]
      let dirty = false

      op.value.forEach(digest => {
          let index = c.findIndex(x => x.digest === digest && (userUUID === doc.author || userUUID === x.creator))
          if(index !== -1) {
            c.splice(index, 1)
            dirty = true
          }
        })

      if(dirty) contents = c   
    }
  }

  if (maintainers === doc.maintainers &&
      viewers === doc.viewers &&
      album === doc.album &&
      contents === doc.contents){
    return doc
  }
  
  let update = {
    doctype: doc.doctype,
    docversion: doc.docversion,
    uuid: doc.uuid,
    author: doc.author,
    maintainers,
    viewers,
    album,
    sticky: doc.sticky,
    ctime: doc.ctime,
    mtime: new Date().getTime(),
    contents
  }

  return update
}

export { 
  createMediaShareDoc, 
  updateMediaShareDoc,
  validateMediaShareDoc
}

