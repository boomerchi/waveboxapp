import './MailboxWebView.less'
import PropTypes from 'prop-types'
import React from 'react'
import { CircularProgress, RaisedButton, FontIcon } from 'material-ui'
import { mailboxStore, mailboxDispatch } from 'stores/mailbox'
import { settingsStore, settingsActions } from 'stores/settings'
import BrowserView from 'sharedui/Components/BrowserView'
import CoreService from 'shared/Models/Accounts/CoreService'
import MailboxSearch from './MailboxSearch'
import MailboxTargetUrl from './MailboxTargetUrl'
import MailboxNavigationToolbar from './MailboxNavigationToolbar'
import shallowCompare from 'react-addons-shallow-compare'
import URI from 'urijs'
import { NotificationService } from 'Notifications'
import {
  WB_MAILBOXES_WINDOW_NAVIGATE_BACK,
  WB_MAILBOXES_WINDOW_NAVIGATE_FORWARD,
  WB_MAILBOXES_WINDOW_WEBVIEW_LIFECYCLE_SLEEP,
  WB_MAILBOXES_WINDOW_WEBVIEW_LIFECYCLE_AWAKEN,
  WB_BROWSER_NOTIFICATION_CLICK,
  WB_BROWSER_NOTIFICATION_PRESENT,
  WB_BROWSER_START_SPELLCHECK,
  WB_BROWSER_INJECT_CUSTOM_CONTENT,
  WB_PING_RESOURCE_USAGE,
  WB_PONG_RESOURCE_USAGE,
  WB_MAILBOXES_WINDOW_WEBVIEW_ATTACHED,
  WB_MAILBOXES_WINDOW_SHOW_SETTINGS,
  WB_MAILBOXES_WINDOW_CHANGE_PRIMARY_SPELLCHECK_LANG
} from 'shared/ipcEvents'

const { ipcRenderer } = window.nativeRequire('electron')

const BROWSER_REF = 'browser'
const TOOLBAR_REF = 'toolbar'

export default class MailboxWebView extends React.Component {
  /* **************************************************************************/
  // Class
  /* **************************************************************************/

  static propTypes = Object.assign({
    mailboxId: PropTypes.string.isRequired,
    serviceType: PropTypes.string.isRequired,
    preload: PropTypes.string,
    url: PropTypes.string,
    hasSearch: PropTypes.bool.isRequired
  }, BrowserView.REACT_WEBVIEW_EVENTS.reduce((acc, name) => {
    acc[name] = PropTypes.func
    return acc
  }, {}))
  static defaultProps = {
    hasSearch: true
  }
  static WEBVIEW_METHODS = BrowserView.WEBVIEW_METHODS
  static REACT_WEBVIEW_EVENTS = BrowserView.REACT_WEBVIEW_EVENTS

  /* **************************************************************************/
  // Object Lifecycle
  /* **************************************************************************/

  constructor (props) {
    super(props)

    const self = this
    this.constructor.WEBVIEW_METHODS.forEach((m) => {
      if (self[m] !== undefined) { return } // Allow overwriting
      self[m] = function () {
        return self.refs[BROWSER_REF][m].apply(self.refs[BROWSER_REF], Array.from(arguments))
      }
    })
  }

  /* **************************************************************************/
  // Component Lifecycle
  /* **************************************************************************/

  componentDidMount () {
    // Stores
    mailboxStore.listen(this.mailboxesChanged)
    settingsStore.listen(this.settingsChanged)

    // Handle dispatch events
    mailboxDispatch.on('devtools', this.handleOpenDevTools)
    mailboxDispatch.on('refocus', this.handleRefocus)
    mailboxDispatch.on('reload', this.handleReload)
    mailboxDispatch.on(WB_PING_RESOURCE_USAGE, this.pingResourceUsage)
    mailboxDispatch.addGetter('current-url', this.handleGetCurrentUrl)
    ipcRenderer.on(WB_MAILBOXES_WINDOW_NAVIGATE_BACK, this.handleIPCNavigateBack)
    ipcRenderer.on(WB_MAILBOXES_WINDOW_NAVIGATE_FORWARD, this.handleIPCNavigateForward)

    if (!this.state.isActive) {
      if (this.refs[BROWSER_REF]) {
        this.refs[BROWSER_REF].send(WB_MAILBOXES_WINDOW_WEBVIEW_LIFECYCLE_SLEEP, {})
      }
    }
  }

  componentWillUnmount () {
    // Stores
    mailboxStore.unlisten(this.mailboxesChanged)
    settingsStore.unlisten(this.settingsChanged)

    // Handle dispatch events
    mailboxDispatch.removeListener('devtools', this.handleOpenDevTools)
    mailboxDispatch.removeListener('refocus', this.handleRefocus)
    mailboxDispatch.removeListener('reload', this.handleReload)
    mailboxDispatch.removeListener(WB_PING_RESOURCE_USAGE, this.pingResourceUsage)
    mailboxDispatch.removeGetter('current-url', this.handleGetCurrentUrl)
    ipcRenderer.removeListener(WB_MAILBOXES_WINDOW_NAVIGATE_BACK, this.handleIPCNavigateBack)
    ipcRenderer.removeListener(WB_MAILBOXES_WINDOW_NAVIGATE_FORWARD, this.handleIPCNavigateForward)
  }

  componentWillReceiveProps (nextProps) {
    if (this.props.mailboxId !== nextProps.mailboxId || this.props.serviceType !== nextProps.serviceType) {
      this.setState(this.generateState(nextProps))
    } else if (this.props.url !== nextProps.url) {
      this.setState((prevState) => {
        return {
          url: nextProps.url || (prevState.service || {}).url,
          isCrashed: false,
          browserDOMReady: false
        }
      })
    }
  }

  /* **************************************************************************/
  // Data lifecycle
  /* **************************************************************************/

  state = this.generateState(this.props)

  /**
  * Generates the state from the given props
  * @param props: the props to use
  * @return state object
  */
  generateState (props) {
    const mailboxState = mailboxStore.getState()
    const mailbox = mailboxState.getMailbox(props.mailboxId)
    const service = mailbox ? mailbox.serviceForType(props.serviceType) : null
    const settingState = settingsStore.getState()

    return Object.assign(
      {},
      !mailbox || !service ? {
        mailbox: null,
        service: null,
        url: props.url || 'about:blank'
      } : {
        mailbox: mailbox,
        service: service,
        url: props.url || service.url
      },
      {
        browserDOMReady: false,
        isCrashed: false,
        language: settingState.language,
        launchedApp: settingState.launched.app,
        focusedUrl: null,
        snapshot: mailboxState.getSnapshot(props.mailboxId, props.serviceType),
        isActive: mailboxState.isActive(props.mailboxId, props.serviceType),
        isSearching: mailboxState.isSearchingMailbox(props.mailboxId, props.serviceType),
        searchTerm: mailboxState.mailboxSearchTerm(props.mailboxId, props.serviceType),
        searchId: mailboxState.mailboxSearchHash(props.mailboxId, props.serviceType)
      }
    )
  }

  mailboxesChanged = (mailboxState) => {
    const { mailboxId, serviceType } = this.props
    const mailbox = mailboxState.getMailbox(mailboxId)
    const service = mailbox ? mailbox.serviceForType(serviceType) : null

    if (mailbox && service) {
      this.setState({
        mailbox: mailbox,
        service: service,
        isActive: mailboxState.isActive(mailboxId, serviceType),
        snapshot: mailboxState.getSnapshot(mailboxId, serviceType),
        isSearching: mailboxState.isSearchingMailbox(mailboxId, serviceType),
        searchTerm: mailboxState.mailboxSearchTerm(mailboxId, serviceType),
        searchId: mailboxState.mailboxSearchHash(mailboxId, serviceType)
      })
    } else {
      this.setState({ mailbox: null, service: null })
    }
  }

  settingsChanged = (settingsState) => {
    this.setState((prevState) => {
      const update = {
        language: settingsState.language,
        launchedApp: settingsState.launched.app
      }

      // Siphon setting changes down to the webview
      if (settingsState.language !== prevState.language) {
        const prevLanguage = prevState.language
        const nextLanguage = update.language
        if (prevLanguage.spellcheckerLanguage !== nextLanguage.spellcheckerLanguage || prevLanguage.secondarySpellcheckerLanguage !== nextLanguage.secondarySpellcheckerLanguage) {
          this.refs[BROWSER_REF].send(WB_BROWSER_START_SPELLCHECK, {
            language: nextLanguage.spellcheckerLanguage,
            secondaryLanguage: nextLanguage.secondarySpellcheckerLanguage
          })
        }
      }

      return update
    })
  }

  /* **************************************************************************/
  // WebView overwrites
  /* **************************************************************************/

  /**
  * @Pass through to webview.loadURL()
  */
  loadURL = (url) => {
    this.setState({
      browserDOMReady: false,
      isCrashed: false
    })
    return this.refs[BROWSER_REF].loadURL(url)
  }

  /**
  * @return the dom node for the webview
  */
  getWebviewNode = () => {
    return this.refs[BROWSER_REF].getWebviewNode()
  }

  /* **************************************************************************/
  // Dispatcher Events
  /* **************************************************************************/

  /**
  * Handles the inspector dispatch event
  * @param evt: the event that fired
  */
  handleOpenDevTools = (evt) => {
    if (evt.mailboxId === this.props.mailboxId) {
      if (!evt.service && this.state.isActive) {
        this.refs[BROWSER_REF].openDevTools()
      } else if (evt.service === this.props.serviceType) {
        this.refs[BROWSER_REF].openDevTools()
      }
    }
  }

  /**
  * Handles refocusing the mailbox
  * @param evt: the event that fired
  */
  handleRefocus = (evt) => {
    if ((!evt.mailboxId || !evt.service) && this.state.isActive) {
      setTimeout(() => { this.refs[BROWSER_REF].focus() })
    } else if (evt.mailboxId === this.props.mailboxId && evt.service === this.props.serviceType) {
      setTimeout(() => { this.refs[BROWSER_REF].focus() })
    }
  }

  /**
  * Handles reloading the mailbox
  * @param evt: the event that fired
  */
  handleReload = (evt) => {
    const { serviceType, mailboxId } = this.props
    const { service, isActive } = this.state

    if (evt.mailboxId === mailboxId) {
      let shouldReload = false

      if (evt.allServices) {
        shouldReload = true
      } else if (!evt.service && isActive) {
        shouldReload = true
      } else if (evt.service === serviceType) {
        shouldReload = true
      }

      if (shouldReload) {
        if (service) {
          if (service.reloadBehaviour === CoreService.RELOAD_BEHAVIOURS.RELOAD) {
            this.reload()
          } else if (service.reloadBehaviour === CoreService.RELOAD_BEHAVIOURS.RESET_URL) {
            this.loadURL(service.url)
          }
        } else {
          this.reload()
        }
        this.setState({
          isCrashed: false,
          browserDOMReady: false
        })
      }
    }
  }

  /**
  * Pings the webview for the current resource usage
  * @param mailboxId: the id of the mailbox
  * @param serviceType: the type of service
  * @param description: the description that can be passed around for the ping
  */
  pingResourceUsage = ({ mailboxId, serviceType, description }) => {
    if (mailboxId === this.props.mailboxId && serviceType === this.props.serviceType) {
      this.refs[BROWSER_REF].send(WB_PING_RESOURCE_USAGE, { description: description })
    }
  }

  /**
  * Handles getting the current url
  * @param mailboxId: the id of the mailbox
  * @param serviceType: the type of service
  * @return the current url or null if not applicable for use
  */
  handleGetCurrentUrl = ({ mailboxId, serviceType }) => {
    if (mailboxId === this.props.mailboxId && serviceType === this.props.serviceType) {
      return this.refs[BROWSER_REF].getURL()
    } else {
      return null
    }
  }

  /* **************************************************************************/
  // Browser Events
  /* **************************************************************************/

  /**
  * Calls multiple handlers for browser events
  * @param callers: a list of callers to execute
  * @param args: the arguments to supply them with
  */
  multiCallBrowserEvent (callers, args) {
    callers.forEach((caller) => {
      if (caller) {
        caller.apply(this, args)
      }
    })
  }

  /* **************************************************************************/
  // Browser Events : Dispatcher
  /* **************************************************************************/

  /**
  * Dispatches browser IPC messages to the correct call
  * @param evt: the event that fired
  */
  dispatchBrowserIPCMessage (evt) {
    switch (evt.channel.type) {
      case WB_MAILBOXES_WINDOW_SHOW_SETTINGS:
        window.location.hash = '/settings'
        break
      case WB_MAILBOXES_WINDOW_CHANGE_PRIMARY_SPELLCHECK_LANG:
        settingsActions.setSpellcheckerLanguage(evt.channel.data.lang)
        break
      case WB_PONG_RESOURCE_USAGE:
        ipcRenderer.send(WB_PONG_RESOURCE_USAGE, evt.channel.data)
        break
      case WB_BROWSER_NOTIFICATION_PRESENT:
        NotificationService.processHTML5MailboxNotification(
          this.props.mailboxId,
          this.props.serviceType,
          evt.channel.notificationId,
          evt.channel.notification,
          (notificationId) => {
            this.refs[BROWSER_REF].send(WB_BROWSER_NOTIFICATION_CLICK, { notificationId: notificationId })
          }
        )
        break
    }
  }

  /* **************************************************************************/
  // Browser Events
  /* **************************************************************************/

  /**
  * Handles the Browser DOM becoming ready
  */
  handleBrowserDomReady = () => {
    const { service, language, isActive } = this.state

    // Language
    if (language.spellcheckerEnabled) {
      this.refs[BROWSER_REF].send(WB_BROWSER_START_SPELLCHECK, {
        language: language.spellcheckerLanguage,
        secondaryLanguage: language.secondarySpellcheckerLanguage
      })
    }

    // Push the custom user content
    if (service.hasCustomCSS || service.hasCustomJS) {
      this.refs[BROWSER_REF].send(WB_BROWSER_INJECT_CUSTOM_CONTENT, {
        css: service.customCSS,
        js: service.customJS
      })
    }

    // Wake or sleep the browser
    if (isActive) {
      this.refs[BROWSER_REF].send(WB_MAILBOXES_WINDOW_WEBVIEW_LIFECYCLE_AWAKEN, {})
    } else {
      this.refs[BROWSER_REF].send(WB_MAILBOXES_WINDOW_WEBVIEW_LIFECYCLE_SLEEP, {})
    }

    this.setState({
      browserDOMReady: true,
      isCrashed: false
    })
  }

  /**
  * Updates the target url that the user is hovering over
  * @param evt: the event that fired
  */
  handleBrowserUpdateTargetUrl = (evt) => {
    this.setState({ focusedUrl: evt.url !== '' ? evt.url : null })
  }

  /**
  * Handles the webcontents being attached
  * @param webContents: the webcontents that were attached
  */
  handleWebContentsAttached = (webContents) => {
    ipcRenderer.send(WB_MAILBOXES_WINDOW_WEBVIEW_ATTACHED, {
      webContentsId: webContents.id,
      mailboxId: this.props.mailboxId,
      serviceType: this.props.serviceType
    })
  }

  /**
  * Handles the webview crashing
  * @param evt: the event that fired
  */
  handleCrashed = (evt) => {
    console.log(`WebView Crashed ${this.props.mailboxId}:${this.props.serviceType}`, evt)
    this.setState({ isCrashed: true })
  }

  /* **************************************************************************/
  // Browser Events : Navigation
  /* **************************************************************************/

  /**
  * Handles a browser preparing to navigate
  * @param evt: the event that fired
  */
  handleBrowserWillNavigate = (evt) => {
    // the lamest protection again dragging files into the window
    // but this is the only thing I could find that leaves file drag working
    if (evt.url.indexOf('file://') === 0) {
      this.setState((prevState) => {
        return {
          url: URI(prevState.url).addSearch('__v__', new Date().getTime()).toString()
        }
      })
    }

    if (this.refs[TOOLBAR_REF]) {
      this.refs[TOOLBAR_REF].updateBrowserState({
        currentUrl: evt.url,
        canGoBack: this.refs[BROWSER_REF].canGoBack(),
        canGoForward: this.refs[BROWSER_REF].canGoForward()
      })
    }
  }

  /**
  * Handles the browser starting to load
  * @param evt: the event that fired
  */
  handleBrowserDidStartLoading = (evt) => {
    if (this.refs[TOOLBAR_REF]) {
      this.refs[TOOLBAR_REF].updateBrowserState({ isLoading: true })
    }
  }

  /**
  * Handles the browser finishing to load
  * @param evt: the event that fired
  */
  handleBrowserDidStopLoading = (evt) => {
    if (this.refs[TOOLBAR_REF]) {
      this.refs[TOOLBAR_REF].updateBrowserState({ isLoading: false })
    }
  }

  /**
  * Handles the browser navigating in the page
  * @param evt: the event that fired
  */
  handleBrowserDidNavigateInPage = (evt) => {
    if (evt.isMainFrame && this.refs[TOOLBAR_REF]) {
      this.refs[TOOLBAR_REF].updateBrowserState({
        currentUrl: evt.url,
        canGoBack: this.refs[BROWSER_REF].canGoBack(),
        canGoForward: this.refs[BROWSER_REF].canGoForward()
      })
    }
  }

  /**
  * Handles the browser finishing navigate
  * @param evt: the event that fired
  */
  handleBrowserDidNavigate = (evt) => {
    if (this.refs[TOOLBAR_REF]) {
      this.refs[TOOLBAR_REF].updateBrowserState({
        currentUrl: evt.url,
        canGoBack: this.refs[BROWSER_REF].canGoBack(),
        canGoForward: this.refs[BROWSER_REF].canGoForward()
      })
    }
  }

  /* **************************************************************************/
  // Browser Events : Focus
  /* **************************************************************************/

  /**
  * Handles a browser focusing
  */
  handleBrowserFocused () {
    mailboxDispatch.focused(this.props.mailboxId, this.props.serviceType)
  }

  /**
  * Handles a browser un-focusing
  */
  handleBrowserBlurred () {
    mailboxDispatch.blurred(this.props.mailboxId, this.props.serviceType)
  }

  /* **************************************************************************/
  // IPC Events
  /* **************************************************************************/

  /**
  * Handles navigating the mailbox back
  */
  handleIPCNavigateBack = () => {
    if (this.state.isActive) {
      this.refs[BROWSER_REF].goBack()
    }
  }

  /**
  * Handles navigating the mailbox forward
  */
  handleIPCNavigateForward = () => {
    if (this.state.isActive) {
      this.refs[BROWSER_REF].goForward()
    }
  }

  /* **************************************************************************/
  // Rendering
  /* **************************************************************************/

  shouldComponentUpdate (nextProps, nextState) {
    return shallowCompare(this, nextProps, nextState)
  }

  componentDidUpdate (prevProps, prevState) {
    if (prevState.isActive !== this.state.isActive) {
      if (this.state.isActive) {
        if (this.refs[BROWSER_REF]) {
          this.refs[BROWSER_REF].focus()
          this.refs[BROWSER_REF].send(WB_MAILBOXES_WINDOW_WEBVIEW_LIFECYCLE_AWAKEN, {})
        }
      } else {
        if (this.refs[BROWSER_REF]) {
          this.refs[BROWSER_REF].send(WB_MAILBOXES_WINDOW_WEBVIEW_LIFECYCLE_SLEEP, {})
        }
      }
    }
  }

  render () {
    // Extract our props and pass props
    const {
      mailbox,
      service,
      isActive,
      focusedUrl,
      isSearching,
      searchTerm,
      searchId,
      url,
      browserDOMReady,
      isCrashed,
      snapshot,
      launchedApp
    } = this.state

    if (!mailbox || !service) { return false }
    const { className, preload, hasSearch, ...passProps } = this.props
    delete passProps.serviceType
    delete passProps.mailboxId
    const webviewEventProps = BrowserView.REACT_WEBVIEW_EVENTS.reduce((acc, name) => {
      acc[name] = this.props[name]
      delete passProps[name]
      return acc
    }, {})

    // Prep Clasnames and other props
    const saltedClassName = [
      className,
      'ReactComponent-MailboxWebView',
      isActive ? 'active' : undefined
    ].filter((c) => !!c).join(' ')
    const browserViewContainerClassName = [
      'ReactComponent-BrowserContainer',
      service.hasNavigationToolbar ? 'hasNavigationToolbar' : undefined
    ].filter((c) => !!c).join(' ')

    return (
      <div className={saltedClassName}>
        {service.hasNavigationToolbar ? (
          <MailboxNavigationToolbar
            ref={TOOLBAR_REF}
            handleGoHome={() => this.loadURL(url)}
            handleGoBack={() => this.goBack()}
            handleGoForward={() => this.goForward()}
            handleStop={() => this.stop()}
            handleReload={() => this.reload()} />
        ) : undefined}
        <div className={browserViewContainerClassName}>
          <BrowserView
            ref={BROWSER_REF}
            preload={preload}
            partition={'persist:' + mailbox.partition}
            src={url}
            zoomFactor={service.zoomFactor}
            searchId={searchId}
            searchTerm={isSearching ? searchTerm : ''}
            webpreferences={launchedApp.useExperimentalWindowOpener ? 'contextIsolation=yes, nativeWindowOpen=yes' : 'contextIsolation=yes'}
            allowpopups={launchedApp.useExperimentalWindowOpener}
            plugins
            onWebContentsAttached={this.handleWebContentsAttached}

            {...webviewEventProps}

            didStartLoading={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserDidStartLoading, webviewEventProps.didStartLoading], [evt])
            }}
            didStopLoading={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserDidStopLoading, webviewEventProps.didStopLoading], [evt])
            }}
            didNavigateInPage={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserDidNavigateInPage, webviewEventProps.didNavigateInPage], [evt])
            }}
            crashed={(evt) => {
              this.multiCallBrowserEvent([this.handleCrashed, webviewEventProps.crashed], [evt])
            }}
            loadCommit={(evt) => {
              this.multiCallBrowserEvent([webviewEventProps.loadCommit], [evt])
            }}
            didGetResponseDetails={(evt) => {
              this.multiCallBrowserEvent([webviewEventProps.didGetResponseDetails], [evt])
            }}
            didNavigate={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserDidNavigate, webviewEventProps.didNavigate], [evt])
            }}

            domReady={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserDomReady, webviewEventProps.domReady], [evt])
            }}
            ipcMessage={(evt) => {
              this.multiCallBrowserEvent([this.dispatchBrowserIPCMessage, webviewEventProps.ipcMessage], [evt])
            }}
            willNavigate={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserWillNavigate, webviewEventProps.willNavigate], [evt])
            }}
            focus={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserFocused, webviewEventProps.focus], [evt])
            }}
            blur={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserBlurred, webviewEventProps.blur], [evt])
            }}
            updateTargetUrl={(evt) => {
              this.multiCallBrowserEvent([this.handleBrowserUpdateTargetUrl, webviewEventProps.updateTargetUrl], [evt])
            }} />
        </div>
        {browserDOMReady || !snapshot ? undefined : (
          <div className='ReactComponent-MailboxSnapshot' style={{ backgroundImage: `url("${snapshot}")` }} />
        )}
        {!service.hasNavigationToolbar && !browserDOMReady ? (
          <div className='ReactComponent-MailboxLoader'>
            <CircularProgress size={80} thickness={5} />
          </div>
        ) : undefined}
        <MailboxTargetUrl url={focusedUrl} />
        {hasSearch ? (
          <MailboxSearch mailboxId={mailbox.id} serviceType={service.type} />
        ) : undefined}
        {isCrashed ? (
          <div className='ReactComponent-MailboxCrashed'>
            <h1>Whoops!</h1>
            <p>Something went wrong with this mailbox and it crashed</p>
            <RaisedButton
              label='Reload'
              icon={<FontIcon className='material-icons'>refresh</FontIcon>}
              onTouchTap={() => {
                this.reloadIgnoringCache()
                this.setState({ isCrashed: false, browserDOMReady: false })
              }} />
          </div>
        ) : undefined}
      </div>
    )
  }
}
