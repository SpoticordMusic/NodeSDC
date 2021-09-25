import util from 'util';

export default class Utils {
  public static collapseByteList(list: Buffer[]) {
    const size = list.map(l => l.length).reduce((a,b ) => a + b);

    const buffer = Buffer.alloc(size);
    let off = 0;

    list.forEach(l => off += l.copy(buffer, off, 0, l.length));

    return buffer;
  }

  public static format = util.format;
}