const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const frontmatter = require('@github-docs/frontmatter');
const parseLinkHeader = require('parse-link-header');

const checkArgs = require('./utils/check-args');
const { prop } = require('../utils/functional');
const { ADDITIONAL_LOCALES } = require('../utils/constants');

const doI18nFilesExist = (fileName, locales) => {
  const i18nPrefix = path.join(process.cwd(), 'src/i18n/content');
  const baseFileName = fileName.replace('src/content/', '');

  return locales
    .map((locale) => {
      const filePath = path.join(i18nPrefix, locale, baseFileName);
      const fileExists = fs.existsSync(filePath);
      return fileExists ? filePath : null;
    })
    .filter(Boolean);
};

const fetchFilesFromGH = async (url) => {
  let files = [];
  let nextPageLink = url;

  while (nextPageLink) {
    const resp = await fetch(nextPageLink, {
      headers: { authorization: `token ${process.env.GITHUB_TOKEN}` },
    });
    const page = await resp.json();
    nextPageLink = getNextLink(resp.headers.get('Link'));
    files = [...files, ...page];
  }

  return files;
};

const getNextLink = (linkHeader) => {
  const parsedLinkHeader = parseLinkHeader(linkHeader);
  if (parsedLinkHeader && parsedLinkHeader.next) {
    return parsedLinkHeader.next.url || null;
  }
  return null;
};

/**
 * @param {string} url The API url that is used to fetch files.
 */
const checkOutdatedTranslations = async (url) => {
  const files = await fetchFilesFromGH(url);
  const mdxFiles = files
    ? files.filter((file) => path.extname(file.filename) === '.mdx')
    : [];

  const mdxFilesContent = mdxFiles
    .filter((file) => file.status !== 'removed')
    .reduce((files, file) => {
      const contents = fs.readFileSync(path.join(process.cwd(), file.filename));
      const { data } = frontmatter(contents);
      return [...files, { path: file.filename, locales: data.translate || [] }];
    }, []);

  const removedMdxFileNames = mdxFiles
    .filter((f) => f.status === 'removed')
    .map(prop('filename'));

  // if a locale was removed from the translate frontmatter, we want to remove the translated version of that file.

  const modifiedFiles = mdxFilesContent
    .map((file) => {
      const unsetLocales = ADDITIONAL_LOCALES.filter(
        (l) => !file.locales.includes(l)
      );
      return doI18nFilesExist(file.path, unsetLocales);
    })
    .flat();

  const removedFiles = removedMdxFileNames
    .map((name) => doI18nFilesExist(name, ADDITIONAL_LOCALES))
    .flat();

  const orphanedI18nFiles = [...modifiedFiles, ...removedFiles];

  if (orphanedI18nFiles.length > 0) {
    orphanedI18nFiles.forEach((f) =>
      // TODO: improve output
      console.log(
        `ACTION NEEDED: Translation without english version found-- ${f.replace(
          `${process.cwd()}/`,
          ''
        )}`
      )
    );
    throw new Error('Files were found for deletion, see logs for filenames');
  }
};

/** Entrypoint. */
const main = async () => {
  try {
    checkArgs(3);
    const url = process.argv[2];

    await checkOutdatedTranslations(url);
    process.exit(0);
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

module.exports = main;