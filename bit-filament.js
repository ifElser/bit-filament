const isClient = typeof window !== 'undefined'

const TextAPI = isClient ? {
  encode: text => (new TextEncoder()).encode(text),
  decode: data => (new TextDecoder()).decode(Uint8Array.from(data))
} : {
  encode: text => Buffer.from(text),
  decode: data => Buffer.from(data).toString('utf8')
}

const GET_INFO = 0x0F // 0000 1111
const GET_TYPE = 0xF0 // 1111 0000

const   NUMBER   = 0x10 // 00 01 0000

  const   UINT_8   = 0x00 // 0000 0000
  const   UINT_16  = 0x01 // 0000 0001
  const   UINT_32  = 0x02 // 0000 0010
  const   INT_8    = 0x03 // 0000 0011
  const   INT_16   = 0x04 // 0000 0100
  const   INT_32   = 0x05 // 0000 0101
  const   FLOAT_32 = 0x06 // 0000 0110
  const   FLOAT_64 = 0x07 // 0000 0111
  const   FALSE    = 0x0E // 0000 1110
  const   TRUE     = 0x0F // 0000 1111

const   STRING   = 0x20 // 0010 0000
const   REGEXP   = 0x30 // 0011 0000
const   OBJECT   = 0x40 // 0100 0000
const   ARRAY    = 0x50 // 0101 0000
const   BUFFER   = 0x60 // 0110 0000



class BitFilament {

  constructor (customTypes) {

    this.types = {

      [NUMBER]    : {

        twist: n => {
          if(n.constructor.name === 'Boolean') return [NUMBER | (n ? TRUE : FALSE)]
          const s = n.toString(16)
          let NumberInfo = [Float64Array, FLOAT_64]
          if( !/\./.test(s) ) {
            if( n < 0 ) {

              /*    0111 0001 */
              if(       -0x81 < n ) NumberInfo = [Int8Array   , INT_8 ]; else

    /*    0111 0000 0000 0001 */
              if(     -0x8001 < n ) NumberInfo = [Int16Array  , INT_16]; else

    /*    0111 0000 0000 0001 */
              if( -0x80000001 < n ) NumberInfo = [Int32Array  , INT_32];
            } else {
              if( n < 0x100       ) NumberInfo = [Uint8Array  , UINT_8 ]; else
              if( n < 0x10000     ) NumberInfo = [Uint16Array , UINT_16]; else
              if( n < 0x100000000 ) NumberInfo = [Uint32Array , UINT_32];
            }
          }
          const r = Array.from(new Uint8Array(NumberInfo[0].from([n]).buffer))
          r.unshift(NUMBER | NumberInfo[1])
          return r
        },

        untwist: (info, buffer, offset) => {
          return ({
            [UINT_8]   : (buffer, offset) => [buffer[offset], offset + 1],
            [UINT_16]  : (buffer, offset) => {
              const arrayBuffer = new Uint8Array(buffer.slice(offset, offset + 2)).buffer
              return [new Uint16Array(arrayBuffer)[0], offset + 2]
            },
            [UINT_32]  : (buffer, offset) => {
              const arrayBuffer = new Uint8Array(buffer.slice(offset, offset + 4)).buffer
              return [new Uint32Array(arrayBuffer)[0], offset + 4]
            },
            [INT_8]    : (buffer, offset) => [buffer[offset], offset + 1],
            [INT_16]   : (buffer, offset) => {
              const arrayBuffer = new Uint8Array(buffer.slice(offset, offset + 2)).buffer
              return [new Int16Array(arrayBuffer)[0], offset + 2]
            },
            [INT_32]   : (buffer, offset) => {
              const arrayBuffer = new Uint8Array(buffer.slice(offset, offset + 4)).buffer
              return [new Int32Array(arrayBuffer)[0], offset + 4]
            },
            [FLOAT_32] : (buffer, offset) => {
              const arrayBuffer = new Uint8Array(buffer.slice(offset, offset + 4)).buffer
              return [new Float32Array(arrayBuffer)[0], offset + 4]
            },
            [FLOAT_64] : (buffer, offset) => {
              const arrayBuffer = new Uint8Array(buffer.slice(offset, offset + 8)).buffer
              return [new Float64Array(arrayBuffer)[0], offset + 8]
            },

            [FALSE]    : () => [false, offset],
            [TRUE]     : () => [true , offset]

          })[info](buffer, offset)
        }

      },

      [STRING]    : {

        twist: s => {
          const arrayBuffer = Array.from(TextAPI.encode(s))
          const l = []
          const mask = 0xff
          let len = arrayBuffer.length
          while(len) {
            l.unshift(len & mask)
            len >>= 8
          }
          return [STRING | l.length].concat(l).concat(arrayBuffer)
        },

        untwist: (len, buffer, offset) => {
          let l = buffer.slice(offset, offset + len).reduce((l, byte) => (l << 8) | byte, 0)
          let s = TextAPI.decode(new Uint8Array(buffer.slice(offset + len, offset + len + l)))
          return [s, offset + len + l]
        }

      },

      [REGEXP]    : {

        twist: r => {
          const ret = this.types[STRING].twist(r.toString())
          ret[0] = REGEXP | (ret[0] & GET_INFO)
          return ret
        },

        untwist: (len, buffer, offset) => {
          const ret = this.types[STRING].untwist(len, buffer, offset)
          ret[0] = new RegExp(ret[0].replace(/^\/(.*)\/g?i?m?u?y?$/, '$1'), ret[0].replace(/^\/.*\/(g?i?m?u?y?)$/, '$1'))
          return ret
        }

      },

      [OBJECT]    : {

        twist: o => {
          o = Object.entries(o)
          const l = []
          const mask = 0xff
          let len = o.length
          while(len) {
            l.unshift(len & mask)
            len >>= 8
          }
          return o.reduce((filament, [key, value]) => {
            key = this.types[STRING].twist(key)
            return filament.concat(key).concat(this.twist(value))
          }, [OBJECT | l.length].concat(l))
        },

        untwist: (len, buffer, offset) => {
          let l = buffer.slice(offset, offset + len).reduce((l, byte) => (l << 8) | byte, 0)
          offset += len
          const obj = {}
          while(l--){
            const [key, offs] = this.untwist(buffer, offset)
            const [v, o] = this.untwist(buffer, offs)
            obj[key] = v
            offset = o
          }
          return [obj, offset]
        }

      },

      [ARRAY]     : {

        twist: a => {
          a = Array.from(a)
          const l = []
          const mask = 0xff
          let len = a.length
          while(len) {
            l.unshift(len & mask)
            len >>= 8
          }
          return a.reduce((filament, el) => filament.concat(this.twist(el)), [ARRAY | l.length].concat(l))
        },

        untwist: (len, buffer, offset) => {
          let l = buffer.slice(offset, offset + len).reduce((l, byte) => (l << 8) | byte, 0)
          offset += len
          const arr = []
          while(l--){
            const [v, o] = this.untwist(buffer, offset)
            arr.push(v)
            offset = o
          }
          return [arr, offset]
        }

      },

      [BUFFER]    : {

        twist: b => {
          b = Array.from(b)
          const l = []
          const mask = 0xff
          let len = b.length
          while(len) {
            l.unshift(len & mask)
            len >>= 8
          }
          return [BUFFER | l.length].concat(l).concat(b)
        },

        untwist: (len, buffer, offset) => {
          let l = buffer.slice(offset, offset + len).reduce((l, byte) => (l << 8) | byte, 0)
          let b = buffer.slice(offset + len, offset + len + l)
          return [b, offset + len + l]
        }

      }

    }

  }

  inspect (arg) {
    if(arg === null || typeof arg === 'undefined') return null;

    if(typeof arg === 'string') return STRING;
    if(typeof arg === 'number' || typeof arg === 'boolean') return NUMBER;

    if(arg instanceof Uint8Array || (typeof Buffer !== 'undefined' && arg instanceof Buffer)) return BUFFER;
    if(arg instanceof RegExp) return REGEXP;

    if(
       arg instanceof Array        ||
       arg instanceof Uint16Array  ||
       arg instanceof Uint32Array  ||
       arg instanceof Int8Array    ||
       arg instanceof Int16Array   ||
       arg instanceof Int32Array   ||
       arg instanceof Float32Array ||
       arg instanceof Float64Array
    ) return ARRAY;

    return OBJECT;
  }

  twist (arg) {
    return this.types[this.inspect(arg)].twist(arg)
  }

  untwist (buffer, offset = 0) {


    if(buffer instanceof ArrayBuffer) buffer = new Uint8Array(buffer); else
    if(!(buffer instanceof Uint8Array)) buffer = Uint8Array.from(buffer)

    const infoByte = buffer[offset]

    const type = infoByte & GET_TYPE
    const info = infoByte & GET_INFO

    // console.log({type, info, buffer})

    return this.types[type].untwist(info, buffer, offset + 1)

  }
}

module.exports = BitFilament

