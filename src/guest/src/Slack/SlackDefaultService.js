const { webFrame } = require('electron')
const Browser = require('../Browser/Browser')
const Wavebox = require('../Wavebox/Wavebox')

class TrelloDefaultService {
  /* **************************************************************************/
  // Lifecycle
  /* **************************************************************************/

  constructor () {
    this.browser = new Browser()
    this.wavebox = new Wavebox()

    webFrame.insertCSS(`
      #macssb1_banner { display:none; }
    `)
  }
}

module.exports = TrelloDefaultService
