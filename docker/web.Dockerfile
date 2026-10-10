# The plugin supports PHP 7.4 (the garrison's host) through the latest 8.x, and the suite
# runs on either: PHP_VERSION in .env or the environment picks the image (see
# docker-compose.yml). CI runs both ends.
ARG PHP_VERSION=7.4
FROM php:${PHP_VERSION}-apache

# MyBB's required PHP extensions.
# Bullseye (the 7.4 image) is past its security-team EOL and the debian-security pool no
# longer serves the versions its index advertises, which breaks `apt-get install`
# outright. The main and updates suites still resolve, so drop the security line before
# installing. Newer images keep their sources in sources.list.d/ and have no such file.
# OPcache is compiled into PHP from 8.5 on, and docker-php-ext-install fails on an
# extension that is already there, so it is only built where it is missing.
RUN if [ -f /etc/apt/sources.list ]; then sed -i '/debian-security/d' /etc/apt/sources.list; fi \
    && apt-get update && apt-get install -y --no-install-recommends \
        libpng-dev \
        libjpeg-dev \
        libfreetype-dev \
        libzip-dev \
        libicu-dev \
        libxml2-dev \
        default-mysql-client \
        unzip \
        curl \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" gd mysqli pdo pdo_mysql zip intl \
        $(php -m | grep -qi "zend opcache" || echo opcache) \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN a2enmod rewrite \
    && printf '<Directory /var/www/html>\n\tOptions Indexes FollowSymLinks\n\tAllowOverride All\n\tRequire all granted\n</Directory>\n' \
        > /etc/apache2/conf-available/mybb.conf \
    && a2enconf mybb

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-mybb.ini

WORKDIR /var/www/html
EXPOSE 80
CMD ["apache2-foreground"]
