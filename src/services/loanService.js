const LoanRepository = require('../database/repositories/loanRepository');
const BookRepository = require('../database/repositories/bookRepository');
const ValidationError = require('../errors/validationError');
const AbstractRepository = require('../database/repositories/abstractRepository');
const Roles=require('../security/roles');
const SettingsService=require('../services/settingsService');
const moment=require('moment');

module.exports = class LoanService {
  constructor({ currentUser, language }) {
    this.repository = new LoanRepository();
    this.bookRepository=new BookRepository();
    this.currentUser = currentUser;
    this.language = language;
  }

  async create(data) {

    if(!(await this._hasBookInStock(data))){
      throw new ValidationError(
        this.language,
        'entities.loan.validation.bookOutOfStock',
      );
    }

    data.dueDAte=await this._calculateDueDate(data);

    const session = await AbstractRepository.createSession();

    try {
      const record = await this.repository.create(data, {
        session: session,
        currentUser: this.currentUser,
      });

      await this.bookRepository.refreshStock(
        record.book.id,
        {
          session,
          currentUser:this.currentUser,
          language:this.language,
        },
      )

      await AbstractRepository.commitTransaction(session);

      return record;
    } catch (error) {
      await AbstractRepository.abortTransaction(session);
      throw error;
    }
  }

  async update(id, data) {
    if(!data.returnDate){
      throw new ValidationError(
        this.language,
        'entities.loan.validation.returnDateRequired',
      )
    }
    const session = await AbstractRepository.createSession();

    try {
      const record = await this.repository.update(
        id,
        data,
        {
          session,
          currentUser: this.currentUser,
        },
      );
      
      await this.bookRepository.refreshStock(
        record.book.id,
        {
          session,
          currentUser:this.currentUser,
          language:this.language,
        },
      )
      await AbstractRepository.commitTransaction(session);

      return record;
    } catch (error) {
      await AbstractRepository.abortTransaction(session);
      throw error;
    }
  }

  async destroyAll(ids) {
    const session = await AbstractRepository.createSession();

    try {
      for (const id of ids) {
        const record=await this.repository.findById(id,{
          session,
          currentUser:this.currentUser,
        });
        
        await this.repository.destroy(id, {
          session,
          currentUser: this.currentUser,
        });
        await this.bookRepository.refreshStock(
          record.book.id,
          {
            session,
            currentUser:this.currentUser,
            language:this.language,
          },
        )
      }

      await AbstractRepository.commitTransaction(session);
    } catch (error) {
      await AbstractRepository.abortTransaction(session);
      throw error;
    }
  }

  async findById(id) {
    return this.repository.findById(id);
  }

  async findAllAutocomplete(search, limit) {
    return this.repository.findAllAutocomplete(search, limit);
  }

  async findAndCountAll(args) {
    const isMember=this.currentUser.roles.includes(Roles.values.member) && !this.currentUser.roles.includes(Roles.values.librarian);;

    if(isMember){
      args.filter={
        ...args.filter,
        member:this.currentUser.id
      }
    }
    return this.repository.findAndCountAll(args);
  }

  async import(data, importHash) {
    if (!importHash) {
      throw new ValidationError(
        this.language,
        'importer.errors.importHashRequired',
      );
    }

    if (await this._isImportHashExistent(importHash)) {
      throw new ValidationError(
        this.language,
        'importer.errors.importHashExistent',
      );
    }

    const dataToCreate = {
      ...data,
      importHash,
    };

    return this.create(dataToCreate);
  }

  async _isImportHashExistent(importHash) {
    const count = await this.repository.count({
      importHash,
    });

    return count > 0;
  }

  async _hasBookInStock(data){
    const book=await this.bookRepository.findById(
      data.book,
    );
    return book.stock > 0;
  }

  async _calculateDueDate(data){
    const settings=await SettingsService.findOrCreateDefault(this.currentUser);
    return moment(data.issueDate).add(settings.loanPeriodInDays,'days').toISOString();
  }
};
