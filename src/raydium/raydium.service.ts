import { Injectable } from '@nestjs/common';
import { CreateRaydiumDto } from './dto/create-raydium.dto.js';
import { UpdateRaydiumDto } from './dto/update-raydium.dto.js';

@Injectable()
export class RaydiumService {
  create(createRaydiumDto: CreateRaydiumDto) {
    return 'This action adds a new raydium';
  }

  findAll() {
    return `This action returns all raydium`;
  }

  findOne(id: number) {
    return `This action returns a #${id} raydium`;
  }

  update(id: number, updateRaydiumDto: UpdateRaydiumDto) {
    return `This action updates a #${id} raydium`;
  }

  remove(id: number) {
    return `This action removes a #${id} raydium`;
  }
}
