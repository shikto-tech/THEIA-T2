/********************************************************************************
 * Copyright (C) 2021 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import * as path from 'path';
import * as fs from '@theia/core/shared/fs-extra';
import { LocalizationProvider } from '@theia/core/lib/node/i18n/localization-provider';
import { Localization } from '@theia/core/lib/common/i18n/localization';
import { inject, injectable } from '@theia/core/shared/inversify';
import { DeployedPlugin, Localization as PluginLocalization } from '../../common';
import { URI } from '@theia/core/shared/vscode-uri';

@injectable()
export class HostedPluginLocalizationService {

    @inject(LocalizationProvider)
    private readonly localizationProvider: LocalizationProvider;

    deployLocalizations(plugin: DeployedPlugin): void {
        if (plugin.contributes?.localizations) {
            this.localizationProvider.addLocalizations(...buildLocalizations(plugin.contributes.localizations));
        }
    }

    async localizePlugin(plugin: DeployedPlugin): Promise<void> {
        const pluginId = plugin.metadata.model.id;
        try {
            const packageDir = URI.parse(plugin.metadata.model.packageUri).fsPath;
            if (await this.localizePackage(pluginId, packageDir)) {
                await this.localizeFiles(pluginId, packageDir);
            }
        } catch (err) {
            console.error(`Failed to localize plugin '${pluginId}'.`, err);
        }
    }

    protected async localizePackage(pluginId: string, pluginPath: string): Promise<boolean> {
        const languages = this.localizationProvider.getAvailableLanguages();
        if (languages.length === 0) {
            return false;
        }
        const nlsPath = path.join(pluginPath, 'package.nls.json');
        const exists = await fs.pathExists(nlsPath);
        if (exists) {
            const nlsContent: Record<string, string> = await fs.readJson(nlsPath);
            for (const language of languages) {
                const nlsLocalizationPath = path.join(pluginPath, `package.nls.${language}.json`);
                if (!await fs.pathExists(nlsLocalizationPath)) {
                    const localization = this.localizationProvider.loadLocalization(language);
                    const nlsLocalization: Record<string, string> = {};
                    for (const [key, original] of Object.entries(nlsContent)) {
                        const translationKey = `${pluginId}/package/${key}`;
                        nlsLocalization[key] = Localization.localize(localization, translationKey, original);
                    }
                    await fs.writeJson(nlsLocalizationPath, nlsLocalization);
                }
            }
        }
        return exists;
    }

    protected async localizeFiles(pluginId: string, pluginPath: string): Promise<void> {
        const files: string[] = [];
        await this.readdirRecursive(pluginPath, files);
        for (const file of files) {
            const fileName = path.basename(file);
            if (fileName === 'nls.metadata.json') {
                this.localizeBundle(pluginId, file);
                break;
            } else if (fileName.endsWith('.nls.metadata.json')) {
                this.localizeEntry(pluginId, file);
            }
        }
    }

    protected async localizeBundle(pluginId: string, bundlePath: string): Promise<void> {
        const nlsContent: LocalizationBundle = await fs.readJson(bundlePath);
        const parentDir = path.dirname(bundlePath);
        const languages = this.localizationProvider.getAvailableLanguages();
        for (const language of languages) {
            const nlsLocalizationPath = path.join(parentDir, `nls.bundle.${language}.json`);
            if (!await fs.pathExists(nlsLocalizationPath)) {
                const localization = this.localizationProvider.loadLocalization(language);
                const bundle: Record<string, string[]> = {};
                for (const [fileKey, entry] of Object.entries(nlsContent)) {
                    const nlsFileKey = Localization.transformKey(fileKey);
                    const output: string[] = [];
                    for (let i = 0; i < entry.keys.length; i++) {
                        const nlsKey = `${pluginId}/${nlsFileKey}/${entry.keys[i]}`;
                        const defaultValue = entry.messages[i];
                        output[i] = Localization.localize(localization, nlsKey, defaultValue);
                    }
                    bundle[fileKey] = output;
                }

                await fs.writeJson(nlsLocalizationPath, bundle);
            }
        }
    }

    protected async localizeEntry(pluginId: string, entryPath: string): Promise<void> {
        const entry: LocalizationEntry = await fs.readJson(entryPath);
        const parentDir = path.dirname(entryPath);
        const nlsFileKey = Localization.transformKey(entry.filePath);
        const languages = this.localizationProvider.getAvailableLanguages();
        for (const language of languages) {
            const nlsLocalizationPath = path.join(parentDir, `${entry.filePath}.nls.${language}.json`);
            if (!await fs.pathExists(nlsLocalizationPath)) {
                const localization = this.localizationProvider.loadLocalization(language);
                const output: string[] = [];
                for (let i = 0; i < entry.keys.length; i++) {
                    const nlsKey = `${pluginId}/${nlsFileKey}/${entry.keys[i]}`;
                    const defaultValue = entry.messages[i];
                    output[i] = Localization.localize(localization, nlsKey, defaultValue);
                }

                await fs.writeJson(nlsLocalizationPath, output);
            }
        }
    }

    protected async readdirRecursive(directory: string, paths: string[]): Promise<void> {
        const dirents = await fs.promises.readdir(directory, { withFileTypes: true });
        await Promise.all(dirents.map(async dirent => {
            const res = path.resolve(directory, dirent.name);
            if (dirent.isDirectory()) {
                await this.readdirRecursive(res, paths);
            } else {
                paths.push(res);
            }
        }));
    }
}

export interface LocalizationBundle {
    [record: string]: Omit<LocalizationEntry, 'filePath'>;
}

export interface LocalizationEntry {
    messages: string[]
    keys: string[]
    filePath: string
}

function buildLocalizations(localizations: PluginLocalization[]): Localization[] {
    const theiaLocalizations: Localization[] = [];
    for (const localization of localizations) {
        const theiaLocalization: Localization = {
            languageId: localization.languageId,
            languageName: localization.languageName,
            localizedLanguageName: localization.localizedLanguageName,
            languagePack: true,
            translations: {}
        };
        for (const translation of localization.translations) {
            for (const [scope, value] of Object.entries(translation.contents)) {
                for (const [key, item] of Object.entries(value)) {
                    const translationKey = buildTranslationKey(translation.id, scope, key);
                    theiaLocalization.translations[translationKey] = item;
                }
            }
        }
        theiaLocalizations.push(theiaLocalization);
    }
    return theiaLocalizations;
}

function buildTranslationKey(pluginId: string, scope: string, key: string): string {
    return `${pluginId}/${Localization.transformKey(scope)}/${key}`;
}
