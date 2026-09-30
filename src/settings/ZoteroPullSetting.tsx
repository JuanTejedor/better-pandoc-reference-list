import React from 'react';
import ReferenceList from 'src/main';
import { SettingItem } from './SettingItem';
import { t } from 'src/lang/helpers';
import { DEFAULT_ZOTERO_PORT } from 'src/bib/helpers';
import { ZoteroConnection, ZoteroSource } from 'src/zotero/types';

function validateGroups(
  plugin: ReferenceList,
  groups: Array<{ id: number; name: string }>
) {
  const validated: Array<{ id: number; name: string }> = [];

  plugin.settings.zoteroGroups.forEach((g) => {
    if (groups.some((g2) => g2.id === g.id)) {
      validated.push(g);
    }
  });

  plugin.settings.zoteroGroups = validated;
  plugin.saveSettings();
}

export function ZoteroPullSetting({ plugin }: { plugin: ReferenceList }) {
  const [isEnabled, setIsEnabled] = React.useState(
    !!plugin.settings.pullFromZotero
  );
  const [possibleGroups, setPossibleGroups] = React.useState(
    plugin.settings.zoteroGroups
  );
  const [activeGroups, setActiveGroups] = React.useState(
    plugin.settings.zoteroGroups
  );
  const [connection, setConnection] = React.useState<ZoteroConnection | null>(
    null
  );
  const connected = connection?.state === 'ready';

  const pullUserGroups = React.useCallback(async () => {
    try {
      const zsync = plugin.bibManager.zsync;
      const conn = await zsync.connect();
      setConnection(conn);
      if (conn.state !== 'ready') return;

      const groups = await zsync.listLibraries();
      if (!groups) return;
      validateGroups(plugin, groups);
      setPossibleGroups(groups);
    } catch {
      setConnection({ provider: null, state: 'unreachable' });
    }
  }, []);

  React.useEffect(() => {
    pullUserGroups();
  }, []);

  return (
    <>
      <div className="pwc-setting-item setting-item">
        <SettingItem
          name={t('Pull bibliography from Zotero')}
          description={t(
            'When enabled, bibliography data will be pulled from Zotero rather than a bibliography file.'
          )}
        >
          <div
            onClick={() => {
              setIsEnabled((cur) => {
                plugin.settings.pullFromZotero = !cur;
                if (connected && activeGroups.length == 0) {
                  const myLibrary = possibleGroups.find((g) => g.id === 1);
                  if (myLibrary) {
                    activeGroups.push(myLibrary);
                    plugin.settings.zoteroGroups = activeGroups;
                    setActiveGroups([...activeGroups]);
                  }
                }
                plugin.saveSettings(() => plugin.bibManager.reinit(true));
                return !cur;
              });
            }}
            className={`checkbox-container${isEnabled ? ' is-enabled' : ''}`}
          />
        </SettingItem>
      </div>
      {connection === null || connected ? null : (
        <div className="pwc-setting-item setting-item">
          <SettingItem
            name={
              connection.state === 'local-api-disabled'
                ? t('Zotero is not accepting connections')
                : t('Cannot connect to Zotero')
            }
            description={
              connection.state === 'local-api-disabled'
                ? t(
                    'In Zotero, open Settings > Advanced and enable "Allow other applications on this computer to communicate with Zotero".'
                  )
                : t('Start Zotero and try again.')
            }
          >
            <button onClick={pullUserGroups} className="mod-cta">
              Retry
            </button>
          </SettingItem>
        </div>
      )}
      {!isEnabled ? null : (
        <>
          <div className="pwc-setting-item setting-item">
            <SettingItem
              name={t('Zotero data source')}
              description={t(
                'Automatic uses Zotero and falls back to Better BibTeX.'
              )}
            >
              <select
                className="dropdown"
                defaultValue={plugin.settings.zoteroSource ?? 'auto'}
                onChange={(e) => {
                  plugin.settings.zoteroSource = e.target
                    .value as ZoteroSource;
                  plugin.saveSettings(() => plugin.bibManager.reinit(true));
                  pullUserGroups();
                }}
              >
                <option value="auto">{t('Automatic (recommended)')}</option>
                <option value="native">{t('Zotero')}</option>
                <option value="bbt">{t('Better BibTeX')}</option>
              </select>
            </SettingItem>
          </div>
          <div className="pwc-setting-item setting-item">
            <SettingItem
              name={t('Zotero port')}
              description={t(
                "Use 24119 for Juris-M or specify a custom port if you have changed Zotero's default."
              )}
            >
              <input
                onChange={(e) => {
                  plugin.settings.zoteroPort = e.target.value;
                  plugin.saveSettings();
                }}
                type="text"
                spellCheck={false}
                defaultValue={plugin.settings.zoteroPort ?? DEFAULT_ZOTERO_PORT}
              />
            </SettingItem>
          </div>
          <div className="setting-item pwc-setting-item-wrapper">
            <SettingItem name={t('Libraries to include in bibliography')} />
            {possibleGroups.map((g) => {
              const isEnabled = activeGroups.some((g2) => g2.id === g.id);
              return (
                <div key={g.id} className="pwc-group-toggle">
                  <SettingItem description={g.name}>
                    <div
                      onClick={() => {
                        if (isEnabled) {
                          const next = activeGroups.filter(
                            (g2) => g2.id !== g.id
                          );
                          plugin.settings.zoteroGroups = next;
                          setActiveGroups(next);
                        } else {
                          activeGroups.push(g);
                          plugin.settings.zoteroGroups = activeGroups;
                          setActiveGroups([...activeGroups]);
                        }
                        plugin.saveSettings(() =>
                          plugin.bibManager.reinit(true)
                        );
                      }}
                      className={`checkbox-container${
                        isEnabled ? ' is-enabled' : ''
                      }`}
                    />
                  </SettingItem>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
