import { expect, assert } from 'chai'
import { Buffer } from 'buffer'

import { XX } from '../../src/handshakes/xx'
import { KeyPair } from '../../src/@types/libp2p'
import { generateEd25519Keys } from '../utils'
import { createHandshakePayload, generateKeypair, getHandshakePayload, getHkdf } from '../../src/utils'

describe('XX Handshake', () => {
  const prologue = Buffer.alloc(0)

  it('Test creating new XX session', async () => {
    try {
      const xx = new XX()

      const kpInitiator: KeyPair = await generateKeypair()
      await generateKeypair()

      await xx.initSession(true, prologue, kpInitiator)
    } catch (e) {
      assert(false, e.message)
    }
  })

  it('Test get HKDF', () => {
    const ckBytes = Buffer.from('4e6f6973655f58585f32353531395f58436861436861506f6c795f53484132353600000000000000000000000000000000000000000000000000000000000000', 'hex')
    const ikm = Buffer.from('a3eae50ea37a47e8a7aa0c7cd8e16528670536dcd538cebfd724fb68ce44f1910ad898860666227d4e8dd50d22a9a64d1c0a6f47ace092510161e9e442953da3', 'hex')
    const ck = Buffer.alloc(32)
    ckBytes.copy(ck)

    const [k1, k2, k3] = getHkdf(ck, ikm)
    expect(k1.toString('hex')).to.equal('cc5659adff12714982f806e2477a8d5ddd071def4c29bb38777b7e37046f6914')
    expect(k2.toString('hex')).to.equal('a16ada915e551ab623f38be674bb4ef15d428ae9d80688899c9ef9b62ef208fa')
    expect(k3.toString('hex')).to.equal('ff67bf9727e31b06efc203907e6786667d2c7a74ac412b4d31a80ba3fd766f68')
  })

  async function doHandshake (xx) {
    const kpInit = await generateKeypair()
    const kpResp = await generateKeypair()

    // initiator setup
    const libp2pInitKeys = await generateEd25519Keys()
    const initSignedPayload = await libp2pInitKeys.sign(getHandshakePayload(kpInit.publicKey))

    // responder setup
    const libp2pRespKeys = await generateEd25519Keys()
    const respSignedPayload = await libp2pRespKeys.sign(getHandshakePayload(kpResp.publicKey))

    // initiator: new XX noise session
    const nsInit = xx.initSession(true, prologue, kpInit)
    // responder: new XX noise session
    const nsResp = xx.initSession(false, prologue, kpResp)

    /* STAGE 0 */

    // initiator creates payload
    libp2pInitKeys.marshal().slice(0, 32)
    const libp2pInitPubKey = libp2pInitKeys.marshal().slice(32, 64)

    const payloadInitEnc = await createHandshakePayload(libp2pInitPubKey, initSignedPayload)

    // initiator sends message
    const message = Buffer.concat([Buffer.alloc(0), payloadInitEnc])
    const messageBuffer = xx.sendMessage(nsInit, message)

    expect(messageBuffer.ne.length).not.equal(0)

    // responder receives message
    xx.recvMessage(nsResp, messageBuffer)

    /* STAGE 1 */

    // responder creates payload
    libp2pRespKeys.marshal().slice(0, 32)
    const libp2pRespPubKey = libp2pRespKeys.marshal().slice(32, 64)
    const payloadRespEnc = await createHandshakePayload(libp2pRespPubKey, respSignedPayload)

    const message1 = Buffer.concat([message, payloadRespEnc])
    const messageBuffer2 = xx.sendMessage(nsResp, message1)

    expect(messageBuffer2.ne.length).not.equal(0)
    expect(messageBuffer2.ns.length).not.equal(0)

    // initiator receive payload
    xx.recvMessage(nsInit, messageBuffer2)

    /* STAGE 2 */

    // initiator send message
    const messageBuffer3 = xx.sendMessage(nsInit, Buffer.alloc(0))

    // responder receive message
    xx.recvMessage(nsResp, messageBuffer3)

    assert(nsInit.cs1.k.equals(nsResp.cs1.k))
    assert(nsInit.cs2.k.equals(nsResp.cs2.k))

    return { nsInit, nsResp }
  }

  it('Test handshake', async () => {
    try {
      const xx = new XX()
      await doHandshake(xx)
    } catch (e) {
      assert(false, e.message)
    }
  })

  it('Test symmetric encrypt and decrypt', async () => {
    try {
      const xx = new XX()
      const { nsInit, nsResp } = await doHandshake(xx)
      const ad = Buffer.from('authenticated')
      const message = Buffer.from('HelloCrypto')

      const ciphertext = xx.encryptWithAd(nsInit.cs1, ad, message)
      assert(!Buffer.from('HelloCrypto').equals(ciphertext), 'Encrypted message should not be same as plaintext.')
      const { plaintext: decrypted, valid } = xx.decryptWithAd(nsResp.cs1, ad, ciphertext)

      assert(Buffer.from('HelloCrypto').equals(decrypted), 'Decrypted text not equal to original message.')
      assert(valid)
    } catch (e) {
      assert(false, e.message)
    }
  })

  it('Test multiple messages encryption and decryption', async () => {
    const xx = new XX()
    const { nsInit, nsResp } = await doHandshake(xx)
    const ad = Buffer.from('authenticated')
    const message = Buffer.from('ethereum1')

    const encrypted = xx.encryptWithAd(nsInit.cs1, ad, message)
    const { plaintext: decrypted } = xx.decryptWithAd(nsResp.cs1, ad, encrypted)
    assert.equal('ethereum1', decrypted.toString('utf8'), 'Decrypted text not equal to original message.')

    const message2 = Buffer.from('ethereum2')
    const encrypted2 = xx.encryptWithAd(nsInit.cs1, ad, message2)
    const { plaintext: decrypted2 } = xx.decryptWithAd(nsResp.cs1, ad, encrypted2)
    assert.equal('ethereum2', decrypted2.toString('utf-8'), 'Decrypted text not equal to original message.')
  })
})
