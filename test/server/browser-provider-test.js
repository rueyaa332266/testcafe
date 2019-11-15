const expect                  = require('chai').expect;
const { noop, stubFalse }     = require('lodash');
const nanoid                  = require('nanoid');
const { rmdirSync, statSync } = require('fs');
const { join, dirname }       = require('path');
const proxyquire              = require('proxyquire');
const testcafeBrowserTools    = require('testcafe-browser-tools');
const browserProviderPool     = require('../../lib/browser/provider/pool');
const parseProviderName       = require('../../lib/browser/provider/parse-provider-name');
const BrowserConnection       = require('../../lib/browser/connection');
const ProviderCtor            = require('../../lib/browser/provider/');
const WARNING_MESSAGE         = require('../../lib/notifications/warning-message');

class BrowserConnectionMock extends BrowserConnection {
    constructor () {
        super({ startServingConnection: () => {} }, { openBrowser: () => {} });

        this.ready = true;
    }

    _runBrowser () {
    }

    addWarning (...args) {
        this.message = args[0];
    }
}


describe('Browser provider', function () {
    describe('Path and arguments handling', function () {
        let processedBrowserInfo                 = null;
        let originalBrowserToolsGetBrowserInfo   = null;
        let originalBrowserToolsOpen             = null;
        let originalBrowserToolsGetInstallations = null;

        function getBrowserInfo (arg) {
            return browserProviderPool
                .getBrowserInfo(arg)
                .then(function (browserInfo) {
                    return browserInfo.provider.openBrowser('id', 'test-url', browserInfo.browserName);
                })
                .catch(function (error) {
                    expect(error.message).to.contain('STOP');
                    return processedBrowserInfo;
                });
        }

        before(function () {
            originalBrowserToolsGetBrowserInfo   = testcafeBrowserTools.getBrowserInfo;
            originalBrowserToolsOpen             = testcafeBrowserTools.open;
            originalBrowserToolsGetInstallations = testcafeBrowserTools.getInstallations;

            testcafeBrowserTools.getBrowserInfo = function (path) {
                return {
                    path: path,
                    cmd:  '--internal-arg'
                };
            };

            testcafeBrowserTools.open = function (browserInfo) {
                processedBrowserInfo = browserInfo;

                throw new Error('STOP');
            };

            testcafeBrowserTools.getInstallations = function () {
                return new Promise(function (resolve) {
                    resolve({ chrome: {} });
                });
            };
        });

        after(function () {
            testcafeBrowserTools.getBrowserInfo   = originalBrowserToolsGetBrowserInfo;
            testcafeBrowserTools.open             = originalBrowserToolsOpen;
            testcafeBrowserTools.getInstallations = originalBrowserToolsGetInstallations;
        });

        it('Should parse browser parameters with arguments', function () {
            return getBrowserInfo('path:/usr/bin/chrome --arg1 --arg2')
                .then(function (browserInfo) {
                    expect(browserInfo.path).to.be.equal('/usr/bin/chrome');
                    expect(browserInfo.cmd).to.be.equal('--arg1 --arg2 --internal-arg');
                });
        });

        it('Should parse browser parameters with arguments if there are spaces in a file path', function () {
            return getBrowserInfo('path:`/opt/Google Chrome/chrome` --arg1 --arg2')
                .then(function (browserInfo) {
                    expect(browserInfo.path).to.be.equal('/opt/Google Chrome/chrome');
                    expect(browserInfo.cmd).to.be.equal('--arg1 --arg2 --internal-arg');
                });
        });

        it('Should parse alias with arguments', function () {
            return getBrowserInfo('chrome --arg1 --arg2')
                .then(function (browserInfo) {
                    expect(browserInfo.path).to.be.equal('chrome');
                    expect(browserInfo.cmd).to.contain('--arg1 --arg2 --internal-arg');
                });
        });
    });

    describe('Init/dispose error handling', function () {
        let initShouldSuccess = false;

        const dummyProvider = {
            init: function () {
                if (initShouldSuccess)
                    return Promise.resolve();

                return Promise.reject(new Error('Initialization error'));
            },

            dispose: function () {
                return Promise.reject(new Error('Dispose error'));
            }
        };

        before(function () {
            browserProviderPool.addProvider('dummy', dummyProvider);
        });

        after(function () {
            browserProviderPool.removeProvider('dummy');
        });

        beforeEach(function () {
            initShouldSuccess = false;
        });

        it('Should catch initialization error', function () {
            return browserProviderPool
                .getProvider('dummy')
                .then(function () {
                    throw new Error('Promise rejection expected');
                })
                .catch(function (error) {
                    expect(error.message).to.contain('Initialization error');
                });
        });

        it('Should catch dispose error', function () {
            initShouldSuccess = true;

            return browserProviderPool
                .getProvider('dummy')
                .then(function () {
                    return browserProviderPool.dispose();
                })
                .then(function () {
                    throw new Error('Promise rejection expected');
                })
                .catch(function (error) {
                    expect(error.message).to.contain('Dispose error');
                });
        });
    });

    describe('Browser provider module names handling', function () {
        it('Should resolve short form of a scoped provider', function () {
            expect(parseProviderName('@private/package')).to.deep.equal({
                providerName: '@private/package',
                moduleName:   '@private/testcafe-browser-provider-package'
            });
        });

        it('Should resolve long form of a scoped provider', function () {
            expect(parseProviderName('@private/testcafe-browser-provider-package')).to.deep.equal({
                providerName: '@private/package',
                moduleName:   '@private/testcafe-browser-provider-package'
            });
        });

        it('Should resolve short form of a unscoped provider', function () {
            expect(parseProviderName('package')).to.deep.equal({
                providerName: 'package',
                moduleName:   'testcafe-browser-provider-package'
            });
        });

        it('Should resolve long form of a unscoped provider', function () {
            expect(parseProviderName('testcafe-browser-provider-package')).to.deep.equal({
                providerName: 'package',
                moduleName:   'testcafe-browser-provider-package'
            });
        });
    });

    describe('Module loading', function () {
        const dummyProvider = {
            init: function () {
                return Promise.resolve();
            },

            dispose: function () {
                return Promise.resolve();
            }
        };

        before(function () {
            browserProviderPool.addProvider('@scope/testcafe-browser-provider-dummy', dummyProvider);
        });

        after(function () {
            browserProviderPool.removeProvider('@scope/testcafe-browser-provider-dummy');
        });

        it('Should load scoped browser provider', function () {
            return browserProviderPool.getProvider('@scope/dummy').then(function (provider) {
                expect(provider).to.be.not.null;
            });
        });

        it('Should load unscoped browser provider', function () {
            return browserProviderPool.getProvider('chrome').then(function (provider) {
                expect(provider).to.be.not.null;
            });
        });
    });

    describe('Dedicated providers base', () => {
        describe('isValidBrowserName', function () {
            it('Should return false if a browser is not found', () => {
                const dedicatedBrowserProviderBase = proxyquire('../../lib/browser/provider/built-in/dedicated/base', {
                    'testcafe-browser-tools': {
                        getBrowserInfo () {
                            return null;
                        }
                    }
                });

                const testProvider = Object.assign({}, dedicatedBrowserProviderBase, {
                    providerName: 'browser',

                    _getConfig () {
                        return {};
                    }
                });

                return testProvider
                    .isValidBrowserName('browser')
                    .then(result => {
                        expect(result).to.be.false;
                    });
            });

            it('Should return true if a browser is found', () => {
                const dedicatedBrowserProviderBase = proxyquire('../../lib/browser/provider/built-in/dedicated/base', {
                    'testcafe-browser-tools': {
                        getBrowserInfo () {
                            return { alias: 'browser' };
                        }
                    }
                });

                const testProvider = Object.assign({}, dedicatedBrowserProviderBase, {
                    providerName: 'browser',

                    _getConfig () {
                        return {};
                    }
                });

                return testProvider
                    .isValidBrowserName('browser')
                    .then(result => {
                        expect(result).to.be.true;
                    });
            });
        });
    });

    describe('API', () => {
        describe('Screenshots', () => {
            it('Should add warning if provider does not support `fullPage` screenshots', () => {
                const provider = new ProviderCtor({
                    isLocalBrowser:            () => true,
                    isHeadlessBrowser:         () => false,
                    hasCustomActionForBrowser: () => false
                });

                const bc = new BrowserConnectionMock();

                return provider.takeScreenshot(bc.id, '', 1, 1, true)
                    .then(() => {
                        expect(bc.message).eql(WARNING_MESSAGE.screenshotsFullPageNotSupported);
                    });
            });

            it('Should create a directory in screenshot was made using the plugin', () => {
                const provider = new ProviderCtor({
                    isLocalBrowser:            stubFalse,
                    isHeadlessBrowser:         stubFalse,
                    hasCustomActionForBrowser: stubFalse,
                    takeScreenshot:            noop
                });

                const dir            = `temp${nanoid(7)}`;
                const screenshotPath = join(process.cwd(), dir, 'tmp.png');

                return provider.takeScreenshot('', screenshotPath, 0, 0, false)
                    .then(() => {
                        const stats = statSync(dirname(screenshotPath));

                        expect(stats.isDirectory()).to.be.true;

                        rmdirSync(dirname(screenshotPath));
                    });
            });
        });
    });
});

