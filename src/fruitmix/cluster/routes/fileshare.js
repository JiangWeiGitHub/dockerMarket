const Router = require('express')
import auth from '../middleware/auth'
import config from '../config'

let router = Router()

// get all fileShares of a user
router.get('/', (req, res) => {
  let user = req.user

  config.ipc.call('getUserFileShares', { userUUID: user.uuid }, (err, shares) => {
    if(err) return res.error(err, 400)
    res.success(shares)
  })
})

// create a fileShare
router.post('/', (req, res) => {
  let user = req.user
  let props = Object.assign({}, req.body)

  config.ipc.call('createFileShare', { userUUID: user.uuid, props }, (err, share) => {
    if(err) return res.error(err, 500)
    res.success(share)
  })
})

// update a fileShare
router.patch('/:shareUUID', (req, res) => {
  let user = req.user
  let shareUUID = req.params.shareUUID
  let props = Object.assign({}, req.body)

  config.ipc.call('updateFileShare', { userUUID: user.uuid, shareUUID, props }, (err, newShare) => {
    if(err) return res.error(err, 500)
    res.success(newShare)
  })
})

// delete a fileShare 
router.delete('/:shareUUID', (req, res) => {
  let user = req.user
  let shareUUID = req.params.shareUUID

  config.ipc.call('deleteFileShare', { userUUID: user.uuid, shareUUID }, (err, data) => {
    if(err) return res.error(err, 500)
    res.success()
  })
})

export default router






