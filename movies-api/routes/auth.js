const express = require('express');
const passport = require('passport');
const boom = require('@hapi/boom');
const jwt = require('jsonwebtoken');
const ApiKeysService = require('../services/apiKeys');
const UserService = require('../services/users');
const validationHandler = require('../utils/middleware/validationHandler');

const {
  createUserSchema,
  createProviderUserSchema
} = require('../utils/schemas/users');

const { config } = require('../config/index');

// Debemos hacer uso de nuestra Strategy Basic
require('../utils/auth/stategies/basic');

function authApi(app) {
  const router = express.Router();
  app.use('/api/auth', router);

  const apiKeysService = new ApiKeysService();
  const usersService = new UserService();

  router.post('/sign-in', async (req, res, next) => {
    /** verificamos que del cuerpo venga un atributo que se llame apiKeyToken
     * este es el token que le vamos a pasar el Sign In para determinar que clase de permiso
     * vamos a firmar en el JWT que vamos a devolver
     */
    const { apiKeyToken } = req.body;

    // verificamos si no existe el token
    if (!apiKeyToken) {
      next(boom.unauthorized('apiKeyToken is required'), false);
    }

    // cuando ya tengamos el token, podemos implementar un custom Callback
    // se va ha encargar de ubicar a nuestro usuario en nuestro request.user,
    // en esté caso no nos interesa que úbique al usuario que encuentra en la ubicación basic
    // nosotros lo que queremos es que nos devuelva un JWT Firmado.
    passport.authenticate('basic', (err, user) => {
      try {
        if (err || !user) {
          next(boom.unauthorized(), false);
        }

        // si exite el usuario, procedemos a implementar el req.login
        // vamos definir que no vamos a implementar una session
        // recibimos un error en caso de que exista
        req.login(user, { session: false }, async function(error) {
          if (error) {
            next(error);
          }

          // si no hay error procedemos a buscar nuestro API Key

          const apiKey = await apiKeysService.getApiKey({ token: apiKeyToken });

          if (!apiKey) {
            next(boom.unauthorized());
          }

          // teniendo en cuenta el API Key procedemos a construir nuestro JWT

          const { _id: id, name, email } = user;

          const payload = {
            sub: id,
            name,
            email,
            scopes: apiKey.scopes
          };

          const token = jwt.sign(payload, config.authJwtSecret, {
            expiresIn: '15m'
          });

          return res.status(200).json({ token, user: { id, name, email } });
        });
      } catch (err) {
        next(err);
      }
      // como es un custom Callback, debemos hace un Clousure con la firma de la ruta.
    })(req, res, next);
  });

  router.post('/sign-up', validationHandler(createUserSchema), async function(
    req,
    res,
    next
  ) {
    const { body: user } = req;

    try {
      const createdUserId = await usersService.createUser({ user });

      res.status(201).json({
        data: createdUserId,
        message: 'user created'
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/sign-provider',
    validationHandler(createProviderUserSchema),
    async function(req, res, next) {
      const { body } = req;

      const { apiKeyToken, ...user } = body;

      if (!apiKeyToken) {
        next(boom.unauthorized('apiKeyToken is required'));
      }

      try {
        const queriedUser = await usersService.getOrCreateUser({ user });
        const apiKey = await apiKeysService.getApiKey({ token: apiKeyToken });

        if (!apiKey) {
          next(boom.unauthorized());
        }

        const { _id: id, name, email } = queriedUser;

        const payload = {
          sub: id,
          name,
          email,
          scopes: apiKey.scopes
        };

        const token = jwt.sign(payload, config.authJwtSecret, {
          expiresIn: '15m'
        });

        return res.status(200).json({ token, user: { id, name, email } });
      } catch (error) {
        next(error);
      }
    }
  );
}

module.exports = authApi;
