import debug from 'debug';
import fs from 'fs';
import os from 'os';
import path from 'path';
import setupExitHook from 'async-exit-hook';
import tmp from 'tmp';
import { ensureDir, readDir } from '../utils/promisified-functions';


const TESTCAFE_TMP_DIRS_ROOT = path.join(os.tmpdir(), 'testcafe-tmp');
const LOCKFILE_NAME          = '.testcafe-lockfile';

const USED_TEMP_DIRS = {};

const DEBUG_LOGGER = debug('testcafe:utils:temp-directory');

class LockFile {
    constructor (dirPath) {
        this.path   = path.join(dirPath, LOCKFILE_NAME);
    }

    init () {
        try {
            const fd = fs.openSync(this.path, 'wx');

            fs.closeSync(fd);

            return true;
        }
        catch (e) {
            DEBUG_LOGGER('Failed to init lockfile ' + this.path);
            DEBUG_LOGGER(e);

            return false;
        }
    }

    dispose () {
        try {
            fs.unlinkSync(this.path);
        }
        catch (e) {
            DEBUG_LOGGER('Failed to dispose lockfile ' + this.path);
            DEBUG_LOGGER(e);
        }
    }
}

export default class TempDirectory {
    constructor (namePrefix) {
        this.namePrefix = namePrefix;

        this.path     = '';
        this.lockFile = null;
    }

    async _getTmpDirsList () {
        const tmpDirNames = await readDir(TESTCAFE_TMP_DIRS_ROOT);

        return tmpDirNames
            .filter(tmpDir => !USED_TEMP_DIRS[tmpDir])
            .filter(tmpDir => path.basename(tmpDir).startsWith(this.namePrefix));
    }

    async _findFreeTmpDir (tmpDirNames) {
        for (const tmpDirName of tmpDirNames) {
            const tmpDirPath = path.join(TESTCAFE_TMP_DIRS_ROOT, tmpDirName);

            const lockFile = new LockFile(tmpDirPath);

            if (lockFile.init()) {
                this.path     = tmpDirPath;
                this.lockFile = lockFile;

                return true;
            }
        }

        return false;
    }

    async _createNewTmpDir () {
        this.path = tmp.tmpNameSync({ dir: TESTCAFE_TMP_DIRS_ROOT, prefix: this.namePrefix + '-' });

        await ensureDir(this.path);

        this.lockFile = new LockFile(this.path);

        this.lockFile.init();
    }

    static async createDirectory (prefix) {
        const tmpDir = new TempDirectory(prefix);

        await tmpDir.init();

        return tmpDir;
    }

    static disposeDirectories () {
        Object.values(USED_TEMP_DIRS).forEach(tmpDir => tmpDir.dispose());
    }

    async init () {
        await ensureDir(TESTCAFE_TMP_DIRS_ROOT);

        const tmpDirNames = await this._getTmpDirsList(this.namePrefix);

        DEBUG_LOGGER('Found temp directories:', tmpDirNames);

        const existingTmpDirFound = await this._findFreeTmpDir(tmpDirNames);

        if (!existingTmpDirFound)
            await this._createNewTmpDir();

        DEBUG_LOGGER('Temp directory path: ', this.path);

        USED_TEMP_DIRS[this.path] = this;
    }

    dispose () {
        if (!USED_TEMP_DIRS[this.path])
            return;

        this.lockFile.dispose();

        delete USED_TEMP_DIRS[this.path];
    }
}

setupExitHook(TempDirectory.disposeDirectories);
